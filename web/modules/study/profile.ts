import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { placement, profiles } from "@/db/app-schema";
import { masteredCutoff } from "./placement-rules";

export const LISTS = ["zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre", "ngsl"] as const;
export type ListCode = (typeof LISTS)[number];

export type Profile = typeof profiles.$inferSelect;

/** 一本词书学完后自动接续的下一本(见 docs/positioning.md 的长期路线)。 */
export const NEXT_LIST: Partial<Record<ListCode, ListCode>> = {
  zk: "gk",
  gk: "cet4",
  cet4: "cet6",
  cet6: "ky",
  ky: "ielts",
  ielts: "toefl",
  toefl: "gre",
  ngsl: "cet4",
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return p ?? null;
}

export function clampDailyNew(n: number): number {
  return Math.min(20, Math.max(5, Math.round(n)));
}

export async function saveProfile(
  userId: string,
  input: { list: string; dailyNew: number; retention?: number; adaptive?: boolean },
) {
  if (!(LISTS as readonly string[]).includes(input.list)) throw new Error("未知词书");
  const values = {
    list: input.list,
    dailyNew: clampDailyNew(input.dailyNew),
    retention: Math.min(0.95, Math.max(0.85, input.retention ?? 0.9)),
    ...(input.adaptive === undefined ? {} : { adaptive: input.adaptive ? 1 : 0 }),
  };
  await db
    .insert(profiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: profiles.userId, set: values });
}

/** 词汇量测试得出的跳过范围:freq_rank 不超过该值的词视为已掌握。 */
export async function getCutoff(userId: string): Promise<number> {
  const rows = await db.select().from(placement).where(eq(placement.userId, userId));
  return masteredCutoff(rows);
}

export async function setList(userId: string, list: string) {
  await db.update(profiles).set({ list }).where(eq(profiles.userId, userId));
}

/** 每本词书的词数(有中文释义的)和该用户已学(有卡片)的词数。 */
export async function listProgress(userId: string): Promise<Record<string, { total: number; learned: number }>> {
  const { rows } = await db.execute<{ list: string; total: number; learned: number }>(sql`
    SELECT l.list, count(*)::int AS total,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM app.cards c WHERE c.user_id = ${userId} AND c.word_id = l.word_id))::int AS learned
    FROM vocab.word_lists l JOIN vocab.words w ON w.id = l.word_id
    WHERE w.translation_zh IS NOT NULL AND w.translation_zh <> ''
    GROUP BY l.list`);
  return Object.fromEntries(rows.map((r) => [r.list, { total: r.total, learned: r.learned }]));
}
