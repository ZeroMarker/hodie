"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { type ComponentProps, useEffect, useSyncExternalStore } from "react";
import { clearPageCache, syncPending } from "@/modules/offline/pending";

/** 注册 service worker(只在生产环境,开发时缓存会干扰热更新)。 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const firstVisit = !navigator.serviceWorker.controller;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // 把这次加载用到的静态资源交给 service worker 缓存;第一次访问时连当前页面一起
        const assets = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => new URL(u).origin === location.origin && new URL(u).pathname.startsWith("/_next/static/"));
        reg.active?.postMessage({ type: "cache", assets, page: firstVisit ? location.pathname : null });
      })
      .catch(() => {});
  }, []);
  return null;
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/** 是否离线:Next 检测到请求失败,或浏览器报告没有网络。 */
export function useIsOffline(): boolean {
  const failed = useOffline();
  const noNetwork = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
  return failed || noNetwork;
}

export function OfflineBanner() {
  const offline = useIsOffline();
  if (!offline) return null;
  return (
    <div role="status" className="bg-amber-100 px-6 py-2 text-center text-sm text-amber-900">
      现在离线:可以继续做已打开的题,作答存在本机,联网后自动提交。
    </div>
  );
}

/**
 * 离线时用普通链接整页跳转,由 service worker 返回缓存的页面;
 * 在线时用 Next 的 Link(软导航在离线时会一直等网络)。
 */
export function NavLink(props: ComponentProps<typeof Link> & { href: string }) {
  const offline = useIsOffline();
  if (offline) {
    const { href, className, children } = props;
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return <Link {...props} />;
}

/** 首页打开时补交上次没交上的作答,交上了就刷新统计。 */
export function PendingSync({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    const run = () =>
      syncPending(userId)
        .then((n) => n > 0 && router.refresh())
        .catch(() => {});
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [userId, router]);
  return null;
}

/** 退出登录前清掉本机缓存的页面(含个人学习数据)。 */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={async () => {
        await clearPageCache();
        await action();
      }}
    >
      <button className="text-red-600 underline">退出登录</button>
    </form>
  );
}
