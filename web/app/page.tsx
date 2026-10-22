import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUserId } from "@/modules/auth";
import { getProfile } from "@/modules/study/profile";
import { getStats } from "@/modules/study/stats";
import { listName } from "@/modules/vocab/card";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <Suspense fallback={<p className="text-zinc-500">加载中…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const userId = await currentUserId();
  if (!userId) return <Landing />;
  const profile = await getProfile(userId);
  if (!profile) redirect("/onboarding");
  const s = await getStats(userId);
  const newLeft = Math.max(0, profile.dailyNew - s.today.newCount);
  const done = s.dueToday === 0 && newLeft === 0;
  const max = Math.max(1, ...s.week.map((d) => d.count));

  return (
    <>
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-sm text-zinc-500">{listName(profile.list)} 词书</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Stat label="待复习" value={s.dueToday} />
          <Stat label="今日新词" value={`${s.today.newCount}/${profile.dailyNew}`} />
        </div>
        <Link
          href="/study"
          className={`mt-6 block rounded-lg py-3 text-center font-semibold ${done ? "bg-zinc-100 text-zinc-500" : "bg-zinc-900 text-white"}`}
        >
          {done ? "今日任务已完成,再学一点" : s.today.newCount + s.today.reviewCount > 0 ? "继续学习" : "开始今天的学习"}
        </Link>
      </section>

      <p className="text-center font-serif text-sm italic text-zinc-400">Hodie, non cras</p>

      <section className="grid grid-cols-3 gap-3">
        <Stat label="连续打卡" value={`${s.streak} 天`} card />
        <Stat label="已学" value={s.learned} card />
        <Stat label="已掌握" value={s.mastered} card />
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-sm text-zinc-500">最近 7 天作答</h2>
        <div className="mt-4 flex h-24 items-end gap-2">
          {s.week.map((d) => (
            <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="w-full rounded-t bg-zinc-800" style={{ height: `${(d.count / max) * 80}%`, minHeight: d.count ? 2 : 0 }} title={`${d.day}:${d.count}`} />
              <span className="text-xs text-zinc-400">{d.day.slice(8)}</span>
            </div>
          ))}
        </div>
        {s.today.reviewCount + s.today.newCount > 0 && (
          <p className="mt-4 text-sm text-zinc-500">
            今天作答 {s.today.reviewCount + s.today.newCount} 次,正确率{" "}
            {Math.round((s.today.correctCount / (s.today.reviewCount + s.today.newCount)) * 100)}%,用时{" "}
            {Math.round(s.today.durationMs / 60000)} 分钟
          </p>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, card }: { label: string; value: string | number; card?: boolean }) {
  return (
    <div className={card ? "rounded-2xl bg-white p-4 shadow-sm" : ""}>
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Landing() {
  return (
    <section className="space-y-4 py-10">
      <p className="font-serif text-lg italic text-zinc-500">Hodie, non cras · 今天,而不是明天</p>
      <h1 className="text-3xl font-bold">每天 15 分钟,把考纲词汇记牢</h1>
      <p className="text-zinc-600">
        覆盖中考、高考、四六级、考研、雅思、托福和 GRE 词书。用 FSRS 间隔重复算法安排复习,题目从认词逐步升到拼写,记得越牢间隔越长。
      </p>
      <Link href="/login" className="inline-block rounded-lg bg-zinc-900 px-6 py-3 font-semibold text-white">
        登录 / 注册
      </Link>
    </section>
  );
}
