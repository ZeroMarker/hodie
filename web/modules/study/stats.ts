import "server-only";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { cards, dailyStats } from "@/db/app-schema";
import { dayEnd, streak, studyDay } from "./day";
import { MASTERED_STABILITY } from "./schedule";

export interface Stats {
  streak: number;
  today: { newCount: number; reviewCount: number; correctCount: number; durationMs: number };
  dueToday: number;
  learned: number;
  mastered: number;
  /** 最近 7 天每天的作答数,用于小图 */
  week: { day: string; count: number }[];
}

export async function getStats(userId: string, now = new Date()): Promise<Stats> {
  const today = studyDay(now);
  const [days, [due], [learned], [mastered]] = await Promise.all([
    db
      .select()
      .from(dailyStats)
      .where(eq(dailyStats.userId, userId))
      .orderBy(desc(dailyStats.day))
      .limit(400),
    db
      .select({ n: count() })
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.suspended, 0), lte(cards.due, dayEnd(now)))),
    db.select({ n: count() }).from(cards).where(eq(cards.userId, userId)),
    db
      .select({ n: count() })
      .from(cards)
      .where(and(eq(cards.userId, userId), gte(cards.stability, MASTERED_STABILITY))),
  ]);
  const active = days.filter((d) => d.newCount + d.reviewCount > 0);
  const t = days.find((d) => d.day === today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = studyDay(new Date(now.getTime() - (6 - i) * 86400_000));
    const d = days.find((x) => x.day === day);
    return { day, count: d ? d.newCount + d.reviewCount : 0 };
  });
  return {
    streak: streak(active.map((d) => d.day), today),
    today: {
      newCount: t?.newCount ?? 0,
      reviewCount: t?.reviewCount ?? 0,
      correctCount: t?.correctCount ?? 0,
      durationMs: t?.durationMs ?? 0,
    },
    dueToday: due.n,
    learned: learned.n,
    mastered: mastered.n,
    week,
  };
}
