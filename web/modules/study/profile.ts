import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { placement, profiles } from "@/db/app-schema";
import { masteredCutoff } from "./placement-rules";

export const LISTS = ["zk", "gk", "cet4", "cet6", "ky", "ielts", "toefl", "gre", "ngsl"] as const;
export type ListCode = (typeof LISTS)[number];

export type Profile = typeof profiles.$inferSelect;

export async function getProfile(userId: string): Promise<Profile | null> {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  return p ?? null;
}

export function clampDailyNew(n: number): number {
  return Math.min(20, Math.max(5, Math.round(n)));
}

export async function saveProfile(
  userId: string,
  input: { list: string; dailyNew: number; retention?: number },
) {
  if (!(LISTS as readonly string[]).includes(input.list)) throw new Error("未知词书");
  const values = {
    list: input.list,
    dailyNew: clampDailyNew(input.dailyNew),
    retention: Math.min(0.95, Math.max(0.85, input.retention ?? 0.9)),
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
