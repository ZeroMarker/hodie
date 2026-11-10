// 浏览器端:作答先存 localStorage(按用户分开),提交成功才删,断网或关页面都不丢。
// 另记一份已答题目的 key 和时间,离线打开缓存的学习页时跳过已答过的题。
// localStorage 在隐私模式或被禁用时会抛错,所有读写都包在 try/catch 里,失败时退回只在内存里。
import { submitReviews } from "@/app/actions";
import type { SubmittedLog } from "@/modules/study/submit";

const PENDING = (u: string) => `hodie:pending:${u}`;
const ANSWERED = (u: string) => `hodie:answered:${u}`;
/** 已答记录保留两天,够覆盖「昨天缓存的队列今天离线打开」 */
const ANSWERED_TTL = 2 * 86400_000;

function read<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不下或不可用时放弃持久化
  }
}

export function pendingLogs(userId: string): SubmittedLog[] {
  return read<SubmittedLog[]>(PENDING(userId), []);
}

/** 记下一次作答:加入待提交队列,并标记这道题已答。 */
export function addLog(userId: string, log: SubmittedLog, itemKey: string) {
  write(PENDING(userId), [...pendingLogs(userId), log]);
  const now = Date.now();
  const answered = read<[string, number][]>(ANSWERED(userId), []).filter(([, t]) => now - t < ANSWERED_TTL);
  answered.push([itemKey, now]);
  write(ANSWERED(userId), answered);
}

/** since(毫秒时间戳)之后答过的题目 key。 */
export function answeredSince(userId: string, since: number): Set<string> {
  return new Set(read<[string, number][]>(ANSWERED(userId), []).filter(([, t]) => t >= since).map(([k]) => k));
}

let inflight: Promise<number> | null = null;

/**
 * 把待提交的作答交给服务端,成功的从队列里删掉(期间新增的保留)。返回提交的条数;
 * 同时只有一次提交在进行,并发调用共用同一次。失败时抛错,作答留在队列里下次再交。
 */
export function syncPending(userId: string): Promise<number> {
  inflight ??= (async () => {
    try {
      const logs = pendingLogs(userId);
      if (logs.length === 0) return 0;
      // 服务端按 id 去重,重复提交无害;一次最多 500 条
      const batch = logs.slice(0, 500);
      await submitReviews(batch);
      const done = new Set(batch.map((l) => l.id));
      write(
        PENDING(userId),
        pendingLogs(userId).filter((l) => !done.has(l.id)),
      );
      return batch.length;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 退出登录时清掉本机的页面缓存(service worker 缓存的学习页含个人数据)。 */
export async function clearPageCache() {
  try {
    await caches.delete("hodie-pages");
  } catch {
    // 不支持 Cache API 时没有缓存可清
  }
}
