import Link from "next/link";
import { Suspense } from "react";
import { requireUserId } from "@/modules/auth";
import { MISTAKE_DAYS, recentMistakes } from "@/modules/study/mistakes";
import { PRACTICE_LIMIT } from "@/modules/study/queue";

export default function MistakesPage() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">错题本</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
          返回首页
        </Link>
      </header>
      <Suspense fallback={<p className="text-zinc-500">加载中…</p>}>
        <MistakeList />
      </Suspense>
    </main>
  );
}

async function MistakeList() {
  const userId = await requireUserId();
  const items = await recentMistakes(userId);
  if (items.length === 0) {
    return <p className="rounded-2xl bg-white p-6 text-zinc-600 shadow-sm">最近 {MISTAKE_DAYS} 天没有答错的词。</p>;
  }
  const leeches = items.filter((m) => m.leech).length;
  return (
    <>
      <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-zinc-600">
          最近 {MISTAKE_DAYS} 天答错过 {items.length} 个词
          {leeches > 0 && <>,其中 {leeches} 个忘了 4 次以上,复习时会先重新看词卡</>}。
        </p>
        <Link href="/mistakes/practice" className="block rounded-lg bg-zinc-900 py-3 text-center font-semibold text-white">
          练习最近的 {Math.min(PRACTICE_LIMIT, items.length)} 个错题
        </Link>
        <p className="text-xs text-zinc-400">练习不影响复习安排,到期的词仍按计划复习。</p>
      </section>
      <ul className="divide-y divide-zinc-100 rounded-2xl bg-white shadow-sm">
        {items.map((m) => (
          <li key={m.cardId}>
            <Link href={`/word/${m.wordId}`} className="flex items-baseline justify-between gap-3 px-6 py-3 hover:bg-zinc-50">
              <span className="min-w-0">
                <span className="font-semibold">{m.word}</span>
                {m.leech && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">顽固词</span>}
                <span className="block truncate text-sm text-zinc-500">{m.meaning}</span>
              </span>
              <span className="shrink-0 text-sm text-zinc-400">错 {m.wrong} 次</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
