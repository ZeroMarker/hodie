// Hodie service worker:离线时也能打开最近访问过的页面,继续做当天的题。
// - /_next/static 等带哈希的静态资源:缓存优先(内容不变)。
// - 学习相关页面(首页、学习、错题本、词卡):网络优先,6 秒没响应或断网时用上次缓存的页面。
// - 其他请求(Server Action、RSC 数据、登录)不经过缓存。
// 页面缓存含个人数据,退出登录时由页面清掉 hodie-pages。

const STATIC = "hodie-static-v1";
const PAGES = "hodie-pages";
const STATIC_MAX = 400;
const PAGE_PATHS = [/^\/$/, /^\/study$/, /^\/mistakes$/, /^\/mistakes\/practice$/, /^\/word\/\d+$/];
const NETWORK_TIMEOUT = 6000;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== STATIC && key !== PAGES) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);
const isPage = (url) => PAGE_PATHS.some((re) => re.test(url.pathname));

async function prune(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - STATIC_MAX))) await cache.delete(k);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    prune(cache);
  }
  return res;
}

/** 只缓存正常的页面响应;跳转(如未登录跳到登录页)不缓存。 */
async function savePage(url, res) {
  if (res.ok && !res.redirected && res.type === "basic") {
    const cache = await caches.open(PAGES);
    await cache.put(url.pathname, res.clone());
  }
}

async function networkFirst(request, url) {
  const network = fetch(request).then(async (res) => {
    await savePage(url, res);
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // 断网,走缓存
  }
  const cached = await caches.match(url.pathname, { cacheName: PAGES });
  if (cached) return cached;
  // 没有缓存时等网络结果;网络也失败就显示离线提示
  try {
    return await network;
  } catch {
    return offlinePage();
  }
}

function offlinePage() {
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>离线 · Hodie</title><body style="font-family:system-ui,sans-serif;background:#fafafa;color:#18181b;padding:24px;max-width:36rem;margin:auto">
<h1 style="font-size:1.5rem">现在离线</h1><p>这个页面还没有缓存。联网后再打开;已经做过的题会在联网后自动提交。</p>
<p><a href="/study">打开今天的学习</a> · <a href="/">首页</a></p></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate" && isPage(url)) {
    event.respondWith(networkFirst(request, url));
  } else if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(offlinePage));
  }
});

// 页面加载后把用到的静态资源和当前页面交给 service worker 缓存
// (第一次访问时 service worker 还没接管,这些请求没经过它)。
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "cache") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC);
      for (const u of data.assets || []) {
        try {
          if (!(await cache.match(u))) {
            const res = await fetch(u);
            if (res.ok) await cache.put(u, res);
          }
        } catch {
          // 单个资源失败不影响其他
        }
      }
      if (data.page) {
        const url = new URL(data.page, self.location.origin);
        if (isPage(url)) {
          try {
            await savePage(url, await fetch(url.pathname, { credentials: "same-origin" }));
          } catch {
            // 离线时跳过
          }
        }
      }
    })(),
  );
});
