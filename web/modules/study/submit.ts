import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, dailyStats, reviewLogs } from "@/db/app-schema";
import { studyDay } from "./day";
import { wordForms } from "./forms";
import { type Exercise, grade, normalize, spellingDistance } from "./grade";
import { shortMeaning } from "./meaning";
import { getProfile } from "./profile";
import { type CardState, levelFor, newCardState, schedule } from "./schedule";
import { wordsByIds } from "./words";

export interface SubmittedLog {
  /** 客户端生成的 UUID,用于去重 */
  id: string;
  wordId: number;
  senseId: string;
  exercise: Exercise;
  answer: string;
  durationMs: number;
  reviewedAt: string;
}

export interface SubmitResult {
  id: string;
  correct: boolean;
  rating: number;
  due: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXERCISES = new Set<Exercise>(["choice", "cloze", "spell"]);

export function validLog(l: SubmittedLog): boolean {
  return (
    UUID.test(l.id) &&
    Number.isInteger(l.wordId) &&
    typeof l.senseId === "string" &&
    EXERCISES.has(l.exercise) &&
    typeof l.answer === "string" &&
    l.answer.length <= 200 &&
    Number.isFinite(l.durationMs) &&
    !Number.isNaN(Date.parse(l.reviewedAt))
  );
}

/** 用户各题型答对时耗时的中位数(最近 100 次),样本少于 5 次时用默认值。 */
async function medians(userId: string): Promise<Map<string, number>> {
  const { rows } = await db.execute<{ exercise: string; n: number; med: number }>(sql`
    SELECT exercise, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float AS med
    FROM (
      SELECT exercise, duration_ms,
             row_number() OVER (PARTITION BY exercise ORDER BY reviewed_at DESC) AS rn
      FROM app.review_logs WHERE user_id = ${userId} AND rating > 1
    ) t WHERE rn <= 100 GROUP BY exercise`);
  return new Map(rows.filter((r) => r.n >= 5).map((r) => [r.exercise, r.med]));
}

/**
 * 提交一批作答:按 id 去重,按作答时间顺序重放(判对错 → 评分 → FSRS 调度),
 * 在一个事务里更新 cards、review_logs 和 daily_stats。服务端结果为准。
 */
export async function submitLogs(
  userId: string,
  input: SubmittedLog[],
  now = new Date(),
): Promise<SubmitResult[]> {
  const logs = input
    .filter(validLog)
    .slice(0, 500)
    .map((l) => {
      // 作答时间限制在最近 7 天内,且不晚于服务器时间
      const t = Math.min(now.getTime(), Math.max(now.getTime() - 7 * 86400_000, Date.parse(l.reviewedAt)));
      return { ...l, at: new Date(t), durationMs: Math.max(0, Math.min(600_000, Math.round(l.durationMs))) };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (logs.length === 0) return [];

  const profile = await getProfile(userId);
  if (!profile) throw new Error("请先完成设置");
  const [words, meds] = await Promise.all([
    wordsByIds([...new Set(logs.map((l) => l.wordId))]),
    medians(userId),
  ]);

  return db.transaction(async (tx) => {
    const seen = await tx
      .select({ id: reviewLogs.id })
      .from(reviewLogs)
      .where(inArray(reviewLogs.id, logs.map((l) => l.id)));
    const done = new Set(seen.map((s) => s.id));
    const results: SubmitResult[] = [];

    for (const l of logs) {
      const w = words.get(l.wordId);
      if (!w || done.has(l.id)) continue;
      done.add(l.id);

      const [existing] = await tx
        .select()
        .from(cards)
        .where(and(eq(cards.userId, userId), eq(cards.wordId, l.wordId), eq(cards.senseId, l.senseId)))
        .for("update");
      const before: CardState = existing ?? newCardState(l.at);
      const level = levelFor(before);

      let correct: boolean;
      let distance = 0;
      if (l.exercise === "choice") {
        correct = normalize(l.answer) === normalize(shortMeaning(w.translation_zh, w.core_sense_id));
      } else {
        distance = spellingDistance(l.answer, wordForms(w.word, w.exchange));
        correct = distance === 0;
      }
      const rating = grade({
        exercise: l.exercise,
        level,
        correct,
        distance,
        durationMs: l.durationMs,
        medianMs: meds.get(l.exercise) ?? 8000,
      });
      const after = schedule(before, rating, l.at, profile.retention, profile.fsrsParams);
      const state = { ...after, level: levelFor(after) };

      let cardId: string;
      if (existing) {
        cardId = existing.id;
        await tx.update(cards).set(state).where(eq(cards.id, cardId));
      } else {
        const [row] = await tx
          .insert(cards)
          .values({ userId, wordId: l.wordId, senseId: l.senseId, ...state })
          .returning({ id: cards.id });
        cardId = row.id;
      }

      await tx.insert(reviewLogs).values({
        id: l.id,
        cardId,
        userId,
        exercise: l.exercise,
        level,
        rating,
        durationMs: l.durationMs,
        answer: l.answer,
        reviewedAt: l.at,
        stabilityBefore: existing ? before.stability : null,
        difficultyBefore: existing ? before.difficulty : null,
        stabilityAfter: after.stability,
        difficultyAfter: after.difficulty,
        elapsedDays: before.lastReview ? (l.at.getTime() - before.lastReview.getTime()) / 86400_000 : null,
      });

      const isNew = !existing;
      const ok = correct ? 1 : 0;
      await tx
        .insert(dailyStats)
        .values({
          userId,
          day: studyDay(l.at),
          newCount: isNew ? 1 : 0,
          reviewCount: isNew ? 0 : 1,
          correctCount: ok,
          durationMs: l.durationMs,
        })
        .onConflictDoUpdate({
          target: [dailyStats.userId, dailyStats.day],
          set: {
            newCount: sql`${dailyStats.newCount} + ${isNew ? 1 : 0}`,
            reviewCount: sql`${dailyStats.reviewCount} + ${isNew ? 0 : 1}`,
            correctCount: sql`${dailyStats.correctCount} + ${ok}`,
            durationMs: sql`${dailyStats.durationMs} + ${l.durationMs}`,
          },
        });

      results.push({ id: l.id, correct, rating, due: after.due.toISOString() });
    }
    return results;
  });
}
