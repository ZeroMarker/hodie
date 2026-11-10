"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Speak, speak, useSpeechSupported } from "@/components/speak";
import { addLog, answeredSince, pendingLogs, syncPending } from "@/modules/offline/pending";
import { type Exercise, editDistance, isChoice, normalize } from "@/modules/study/grade";
import type { QueueItem } from "@/modules/study/queue";

type Step = { item: QueueItem; show: boolean; retry: boolean };
type Feedback = { correct: boolean; close: boolean; answer: string };

const FLUSH_EVERY = 10;

// 不支持朗读的浏览器把听力题换成对应的看词题
const FALLBACK: Partial<Record<Exercise, Exercise>> = { listen: "choice", dictation: "spell" };

// 新词每 5 个一组:先依次展示词卡,再做选择题。重学的 leech 卡片先看词卡再答题。
// 答错的词在队尾再出现一次(新词和重学卡片连同词卡)。
function buildSteps(items: QueueItem[]): Step[] {
  const reviews = items
    .filter((i) => !i.isNew)
    .flatMap((item) => [
      ...(item.relearn ? [{ item, show: true, retry: false }] : []),
      { item, show: false, retry: false },
    ]);
  const fresh = items.filter((i) => i.isNew);
  const steps: Step[] = [...reviews];
  for (let g = 0; g < fresh.length; g += 5) {
    const group = fresh.slice(g, g + 5);
    for (const item of group) steps.push({ item, show: true, retry: false });
    for (const item of group) steps.push({ item, show: false, retry: false });
  }
  return steps;
}

/**
 * 学习会话。作答先存本地再批量提交,断网时留在本地,联网或下次打开时补交。
 * generatedAt 是服务端生成队列的时间:页面从离线缓存打开时,跳过此后本地已答过的题。
 * practice:错题练习,只做题不提交,不影响复习安排。
 */
export function Session({
  items,
  userId,
  generatedAt,
  practice = false,
}: {
  items: QueueItem[];
  userId: string;
  generatedAt?: number;
  practice?: boolean;
}) {
  const router = useRouter();
  const tts = useSpeechSupported();
  const [steps, setSteps] = useState(() => buildSteps(items));
  const [pos, setPos] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [stats, setStats] = useState({ done: 0, correct: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sinceFlush = useRef(0);
  const started = useRef(0);

  // 「再来一组」刷新后服务端送来新队列,从头开始
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setSteps(buildSteps(items));
    setPos(0);
    setFeedback(null);
    setStats({ done: 0, correct: 0 });
    setLoading(false);
  }

  const step = steps[pos];
  const finished = pos >= steps.length;
  const exercise = step && (tts ? step.item.exercise : (FALLBACK[step.item.exercise] ?? step.item.exercise));

  useEffect(() => {
    started.current = performance.now();
    // 新词卡、选择题和听力题自动读一遍;拼写题不读,否则等于听写
    if (step && (step.show || exercise === "choice" || exercise === "listen" || exercise === "dictation")) {
      speak(step.item.word);
    }
  }, [pos, step, exercise]);

  async function flush() {
    sinceFlush.current = 0;
    try {
      while ((await syncPending(userId)) > 0 && pendingLogs(userId).length > 0);
      setError(null);
    } catch {
      setError("网络异常,作答已存在本机,联网后会自动提交。");
    }
  }

  // 打开时:跳过离线缓存页面里本地已答过的题,补交上次没交上的作答;联网时再补交
  useEffect(() => {
    if (practice || generatedAt === undefined) return;
    const done = answeredSince(userId, generatedAt);
    // 已答记录在 localStorage 里,服务端渲染时读不到,只能挂载后再过滤
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (done.size > 0) setSteps((ss) => ss.filter((st) => !done.has(st.item.key)));
    flush();
    const online = () => flush();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在打开会话时执行一次
  }, [userId, generatedAt, practice]);

  async function again() {
    setLoading(true);
    // 等作答交完再取新队列,否则刚学的词会被重复选中
    await flush();
    router.refresh();
  }

  function record(answer: string, correct: boolean, close: boolean, display: string) {
    const { item } = step;
    if (!practice) {
      addLog(
        userId,
        {
          id: crypto.randomUUID(),
          wordId: item.wordId,
          senseId: item.senseId,
          exercise,
          answer,
          durationMs: Math.round(performance.now() - started.current),
          reviewedAt: new Date().toISOString(),
        },
        item.key,
      );
      if (++sinceFlush.current >= FLUSH_EVERY) flush();
    }
    setStats((s) => ({ done: s.done + 1, correct: s.correct + (correct ? 1 : 0) }));
    setFeedback({ correct, close, answer: display });
    if (!correct && !step.retry) {
      const retry = { item, show: false, retry: true };
      const extra = item.isNew || item.relearn ? [{ ...retry, show: true }, retry] : [retry];
      setSteps((ss) => [...ss, ...extra]);
    }
  }

  function next() {
    // 最后一题之后把剩余作答交上去
    if (pos + 1 >= steps.length && !practice) flush();
    setFeedback(null);
    setPos((p) => p + 1);
  }

  if (items.length === 0 || finished) {
    return (
      <section className="space-y-4 rounded-2xl bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-bold">
          {practice
            ? items.length === 0
              ? "最近没有错题"
              : "错题练习完成了"
            : items.length === 0
              ? "今天没有要学的了"
              : "今天的任务完成了"}
        </h1>
        {stats.done > 0 && (
          <p className="text-zinc-600">
            作答 {stats.done} 次,答对 {stats.correct} 次。{practice ? "练习不影响复习安排。" : "明天记得回来复习。"}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <Link href="/" className="flex-1 rounded-lg bg-zinc-900 py-3 font-semibold text-white">
            返回首页
          </Link>
          <button
            onClick={again}
            disabled={loading}
            className="flex-1 rounded-lg border border-zinc-300 py-3 disabled:opacity-50"
          >
            {loading ? "正在准备…" : "再来一组"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-1 overflow-hidden rounded bg-zinc-200">
        <div className="h-full bg-zinc-900 transition-all" style={{ width: `${(pos / steps.length) * 100}%` }} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {step.show ? (
        <WordCardView key={pos} item={step.item} onNext={next} />
      ) : (
        <Question
          key={pos}
          item={step.item}
          exercise={exercise}
          feedback={feedback}
          onAnswer={record}
          onNext={next}
        />
      )}
    </div>
  );
}

function WordCardView({ item, onNext }: { item: QueueItem; onNext: () => void }) {
  const c = item.card;
  return (
    <section className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
      <p className="text-xs text-zinc-400">{item.relearn ? "这个词忘了好几次,重新看一遍" : "新词"}</p>
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          {item.word} <Speak text={item.word} />
        </h1>
        <p className="text-zinc-500">
          {item.phonetic && <span>/{item.phonetic}/</span>}
          {c?.cefr && <span className="ml-3">{c.cefr}</span>}
        </p>
      </header>
      <ul className="space-y-1">
        {(c?.translations ?? [item.meaning]).slice(0, 4).map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {c && c.examples.length > 0 && (
        <ul className="space-y-3 border-t border-zinc-100 pt-4">
          {c.examples.map((e) => (
            <li key={e.id}>
              <p className="flex items-start gap-1">
                <span>{e.textEn}</span> <Speak text={e.textEn} className="text-sm" />
              </p>
              <p className="text-sm text-zinc-500">{e.textZh}</p>
            </li>
          ))}
        </ul>
      )}
      {c && c.collocations.length > 0 && (
        <p className="text-sm text-zinc-600">搭配:{c.collocations.map((x) => x.phrase).join(" · ")}</p>
      )}
      {c?.familyOf && (
        <p className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
          和你已经学会的 <span className="font-semibold">{c.familyOf}</span> 是同族词
        </p>
      )}
      {c?.etymology && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">词源:{c.etymology}</p>
      )}
      <button onClick={onNext} className="w-full rounded-lg bg-zinc-900 py-3 font-semibold text-white">
        记住了,下一个
      </button>
    </section>
  );
}

function Question({
  item,
  exercise,
  feedback,
  onAnswer,
  onNext,
}: {
  item: QueueItem;
  exercise: Exercise;
  feedback: Feedback | null;
  onAnswer: (answer: string, correct: boolean, close: boolean, display: string) => void;
  onNext: () => void;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    if (feedback?.correct) {
      const t = setTimeout(onNext, 900);
      return () => clearTimeout(t);
    }
  }, [feedback, onNext]);

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    if (feedback || !text.trim()) return;
    const expected = exercise === "cloze" ? item.cloze!.answer : item.word;
    const d = Math.min(editDistance(normalize(text), normalize(expected)), editDistance(normalize(text), normalize(item.word)));
    onAnswer(text, d === 0, d === 1, expected);
  }

  return (
    <section className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
      {isChoice(exercise) && item.choice && (
        <>
          <p className="text-xs text-zinc-400">{exercise === "listen" ? "听发音,选出中文意思" : "选出中文意思"}</p>
          {exercise === "listen" && !feedback ? (
            <ReplayButton word={item.word} />
          ) : (
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              {item.word} <Speak text={item.word} />
            </h1>
          )}
          <div className="space-y-2">
            {item.choice.options.map((o, i) => {
              const right = i === item.choice!.answer;
              const style = feedback
                ? right
                  ? "border-green-600 bg-green-50"
                  : i === picked
                    ? "border-red-600 bg-red-50"
                    : "border-zinc-200 opacity-60"
                : "border-zinc-200 hover:border-zinc-900";
              return (
                <button
                  key={o}
                  disabled={!!feedback}
                  onClick={() => {
                    setPicked(i);
                    onAnswer(o, right, false, item.meaning);
                  }}
                  className={`block w-full rounded-lg border px-4 py-3 text-left ${style}`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </>
      )}

      {exercise === "cloze" && item.cloze && (
        <form onSubmit={submitTyped} className="space-y-4">
          <p className="text-xs text-zinc-400">填入缺少的单词</p>
          <p className="text-lg leading-relaxed">
            {item.cloze.before}
            <span className="mx-1 inline-block min-w-16 border-b-2 border-zinc-900 text-center font-mono">
              {item.cloze.first}
              {"_".repeat(Math.max(0, item.cloze.length - 1))}
            </span>
            {item.cloze.after}
          </p>
          <p className="text-sm text-zinc-500">{item.cloze.hint ?? item.meaning}</p>
          <TypedInput value={text} onChange={setText} disabled={!!feedback} />
        </form>
      )}

      {exercise === "spell" && (
        <form onSubmit={submitTyped} className="space-y-4">
          <p className="text-xs text-zinc-400">拼写这个单词</p>
          <p className="text-2xl font-semibold">{item.meaning}</p>
          <TypedInput value={text} onChange={setText} disabled={!!feedback} />
        </form>
      )}

      {exercise === "dictation" && (
        <form onSubmit={submitTyped} className="space-y-4">
          <p className="text-xs text-zinc-400">听写:写出听到的单词</p>
          <ReplayButton word={item.word} />
          <TypedInput value={text} onChange={setText} disabled={!!feedback} />
        </form>
      )}

      {feedback && (
        <div className={`rounded-lg px-4 py-3 ${feedback.correct ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {feedback.correct ? (
            "正确"
          ) : (
            <>
              {feedback.close ? "差一点:" : "正确答案:"}
              <span className="font-semibold">{feedback.answer}</span>
              {!isChoice(exercise) && <span className="ml-2">({item.meaning})</span>}
            </>
          )}
        </div>
      )}
      {feedback && !feedback.correct && (
        <button onClick={onNext} autoFocus className="w-full rounded-lg bg-zinc-900 py-3 font-semibold text-white">
          继续
        </button>
      )}
    </section>
  );
}

function ReplayButton({ word }: { word: string }) {
  return (
    <button
      type="button"
      onClick={() => speak(word)}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 py-6 text-2xl hover:border-zinc-900"
    >
      🔊 <span className="text-base text-zinc-500">再听一遍</span>
    </button>
  );
}

function TypedInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="flex gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="flex-1 rounded-lg border border-zinc-300 px-4 py-3 font-mono"
      />
      <button disabled={disabled} className="rounded-lg bg-zinc-900 px-5 font-semibold text-white disabled:opacity-50">
        确定
      </button>
    </div>
  );
}
