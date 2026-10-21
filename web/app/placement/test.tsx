"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { finishPlacement, loadBand } from "@/app/actions";
import type { PlacementQuestion } from "@/modules/study/placement";
import {
  BAND_SIZE,
  type BandResult,
  finished,
  masteredCutoff,
} from "@/modules/study/placement-rules";

export function PlacementTest() {
  const router = useRouter();
  const [band, setBand] = useState(1);
  const [questions, setQuestions] = useState<PlacementQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [known, setKnown] = useState(0);
  const [results, setResults] = useState<BandResult[]>([]);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (done) return;
    let cancelled = false;
    loadBand(band).then((qs) => {
      if (cancelled) return;
      setQuestions(qs);
      setIndex(0);
      setKnown(0);
    });
    return () => {
      cancelled = true;
    };
  }, [band, done]);

  function answer(choice: number | null) {
    if (!questions) return;
    const k = known + (choice === questions[index].answer ? 1 : 0);
    if (index + 1 < questions.length) {
      setKnown(k);
      setIndex(index + 1);
      return;
    }
    const next = [...results, { band, known: k, total: questions.length }];
    setResults(next);
    setQuestions(null);
    if (finished(next)) {
      setDone(true);
      startTransition(() => finishPlacement(next));
    } else {
      setBand(band + 1);
    }
  }

  if (done) {
    const cutoff = masteredCutoff(results);
    return (
      <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-lg">
          {cutoff > 0
            ? `最常用的 ${cutoff} 个词你基本都认识,学习时会跳过它们。`
            : "从最常用的词开始学起。"}
        </p>
        <button
          disabled={pending}
          onClick={() => router.push("/study")}
          className="w-full rounded-lg bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50"
        >
          开始学习
        </button>
      </section>
    );
  }

  if (!questions) return <p className="text-zinc-500">出题中…</p>;
  const q = questions[index];
  return (
    <section className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-sm text-zinc-400">
        第 {band} 档(常用词第 {(band - 1) * BAND_SIZE + 1}–{band * BAND_SIZE} 名) · {index + 1}/{questions.length}
      </p>
      <h2 className="text-3xl font-bold">{q.word}</h2>
      <div className="space-y-2">
        {q.options.map((o, i) => (
          <button
            key={o}
            onClick={() => answer(i)}
            className="block w-full rounded-lg border border-zinc-200 px-4 py-3 text-left hover:border-zinc-900"
          >
            {o}
          </button>
        ))}
        <button onClick={() => answer(null)} className="block w-full rounded-lg px-4 py-3 text-left text-zinc-500 hover:bg-zinc-100">
          不认识
        </button>
      </div>
      <button
        onClick={() => {
          setDone(true);
          startTransition(() => finishPlacement(results));
        }}
        className="text-sm text-zinc-400 underline"
      >
        跳过测试
      </button>
    </section>
  );
}
