import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Grade } from "ts-fsrs";
import { db } from "@/db";
import { cards, dailyStats, reviewLogs } from "@/db/app-schema";
import { studyDay } from "./day";
import { wordForms } from "./forms";
import { type Exercise, grade, isChoice, normalize, spellingDistance } from "./grade";
import { shortMeaning } from "./meaning";
import { getProfile } from "./profile";
import { type CardState, levelFor, newCardState, schedule } from "./schedule";
import { type WordRow, wordsByIds } from "./words";

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
const EXERCISES = new Set<Exercise>(["choice", "listen", "cloze", "spell", "dictation"]);

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

/** 判对错:选择题比对释义,输入题按编辑距离(0 为对)。 */
function check(l: SubmittedLog, w: WordRow): { correct: boolean; distance: number } {
  if (isChoice(l.exercise)) {
    return { correct: normalize(l.answer) === normalize(shortMeaning(w.translation_zh, w.core_sense_id)), distance: 0 };
  }
  const distance = spellingDistance(l.answer, wordForms(w.word, w.exchange));
  return { correct: distance === 0, distance };
}

const cardKey = (wordId: number, senseId: string) => `${wordId}\t${senseId}`;
const excluded = (col: string) => sql.raw(`excluded.${col}`);

/**
 * 提交一批作答:按 id 去重,按作答时间顺序重放(判对错 → 评分 → FSRS 调度),
 * 在一个事务里更新 cards、review_logs 和 daily_stats。服务端结果为准。
 * 一批作答固定 5 次查询:查重、锁定卡片、写卡片、写作答记录、写每日统计。
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
    const todo = logs.filter((l) => {
      if (!words.has(l.wordId) || done.has(l.id)) return false;
      done.add(l.id);
      return true;
    });
    if (todo.length === 0) return [];

    const locked = await tx
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.wordId, [...new Set(todo.map((l) => l.wordId))])))
      .for("update");
    // 每张卡片的当前状态;本批里同一张卡片的多次作答依次累积
    const current = new Map<string, CardState>(locked.map((c) => [cardKey(c.wordId, c.senseId), c]));

    type Row = {
      log: (typeof todo)[number];
      key: string;
      isNew: boolean;
      level: number;
      rating: Grade;
      correct: boolean;
      before: CardState | null;
      after: CardState;
    };
    const rows: Row[] = [];
    for (const l of todo) {
      const key = cardKey(l.wordId, l.senseId);
      const prev = current.get(key) ?? null;
      const before = prev ?? newCardState(l.at);
      const level = levelFor(before);
      const { correct, distance } = check(l, words.get(l.wordId)!);
      const rating = grade({
        exercise: l.exercise,
        level,
        correct,
        distance,
        durationMs: l.durationMs,
        medianMs: meds.get(l.exercise) ?? 8000,
      });
      const after = schedule(before, rating, l.at, profile.retention, profile.fsrsParams);
      current.set(key, after);
      // 卡片的第一次作答算新学;同批里之后的作答已有状态,算复习
      const isNew = !prev;
      rows.push({ log: l, key, isNew, level, rating, correct, before: prev, after });
    }

    const touched = [...new Set(rows.map((r) => r.key))].map((key) => {
      const [wordId, senseId] = key.split("\t");
      const c = current.get(key)!;
      return {
        userId,
        wordId: Number(wordId),
        senseId,
        level: levelFor(c),
        due: c.due,
        stability: c.stability,
        difficulty: c.difficulty,
        learningSteps: c.learningSteps,
        reps: c.reps,
        lapses: c.lapses,
        state: c.state,
        lastReview: c.lastReview,
      };
    });
    const saved = await tx
      .insert(cards)
      .values(touched)
      .onConflictDoUpdate({
        target: [cards.userId, cards.wordId, cards.senseId],
        set: {
          level: excluded("level"),
          due: excluded("due"),
          stability: excluded("stability"),
          difficulty: excluded("difficulty"),
          learningSteps: excluded("learning_steps"),
          reps: excluded("reps"),
          lapses: excluded("lapses"),
          state: excluded("state"),
          lastReview: excluded("last_review"),
        },
      })
      .returning({ id: cards.id, wordId: cards.wordId, senseId: cards.senseId });
    const cardIds = new Map(saved.map((c) => [cardKey(c.wordId, c.senseId), c.id]));

    await tx.insert(reviewLogs).values(
      rows.map((r) => ({
        id: r.log.id,
        cardId: cardIds.get(r.key)!,
        userId,
        exercise: r.log.exercise,
        level: r.level,
        rating: r.rating,
        durationMs: r.log.durationMs,
        answer: r.log.answer,
        reviewedAt: r.log.at,
        stabilityBefore: r.before ? r.before.stability : null,
        difficultyBefore: r.before ? r.before.difficulty : null,
        stabilityAfter: r.after.stability,
        difficultyAfter: r.after.difficulty,
        elapsedDays: r.before?.lastReview ? (r.log.at.getTime() - r.before.lastReview.getTime()) / 86400_000 : null,
      })),
    );

    const days = new Map<string, { newCount: number; reviewCount: number; correctCount: number; durationMs: number }>();
    for (const r of rows) {
      const day = studyDay(r.log.at);
      const d = days.get(day) ?? { newCount: 0, reviewCount: 0, correctCount: 0, durationMs: 0 };
      if (r.isNew) d.newCount++;
      else d.reviewCount++;
      if (r.correct) d.correctCount++;
      d.durationMs += r.log.durationMs;
      days.set(day, d);
    }
    await tx
      .insert(dailyStats)
      .values([...days].map(([day, d]) => ({ userId, day, ...d })))
      .onConflictDoUpdate({
        target: [dailyStats.userId, dailyStats.day],
        set: {
          newCount: sql`${dailyStats.newCount} + ${excluded("new_count")}`,
          reviewCount: sql`${dailyStats.reviewCount} + ${excluded("review_count")}`,
          correctCount: sql`${dailyStats.correctCount} + ${excluded("correct_count")}`,
          durationMs: sql`${dailyStats.durationMs} + ${excluded("duration_ms")}`,
        },
      });

    return rows.map((r) => ({ id: r.log.id, correct: r.correct, rating: r.rating, due: r.after.due.toISOString() }));
  });
}
