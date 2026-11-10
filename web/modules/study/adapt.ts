import "server-only";
import { and, count, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, profiles } from "@/db/app-schema";
import { type Boosts, type ExerciseStat, adapt } from "./adapt-rules";
import { dayEnd, studyDay } from "./day";
import { type Profile, getProfile } from "./profile";
import { State } from "./schedule";

/**
 * 读取用户设置,并在每个学习日第一次读取时按最近 7 天的复习表现做一次自适应:
 * 调整每天新词数(用户关掉自适应时不调)、更新偏难题型的加倍。
 */
export async function getAdaptedProfile(userId: string, now = new Date()): Promise<Profile | null> {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const today = studyDay(now);
  if (profile.adaptedOn === today) return profile;

  const dayStart = new Date(dayEnd(now).getTime() - 86400_000);
  const since = new Date(dayStart.getTime() - 7 * 86400_000);
  const [{ rows: stats }, [{ overdue }]] = await Promise.all([
    // 只算复习(作答前已有稳定性),不算新词的第一次作答
    db.execute<ExerciseStat>(sql`
      SELECT exercise, count(*)::int AS total, (count(*) FILTER (WHERE rating = 1))::int AS wrong
      FROM app.review_logs
      WHERE user_id = ${userId} AND stability_before IS NOT NULL
        AND reviewed_at >= ${since.toISOString()} AND reviewed_at < ${dayStart.toISOString()}
      GROUP BY exercise`),
    // 积压:今天之前就到期的复习卡片;学习和重学阶段的卡片间隔只有几分钟,不算
    db
      .select({ overdue: count() })
      .from(cards)
      .where(
        and(eq(cards.userId, userId), eq(cards.suspended, 0), eq(cards.state, State.Review), lt(cards.due, dayStart)),
      ),
  ]);

  const r = adapt({ dailyNew: profile.dailyNew, stats, overdue, today, boosts: profile.boosts as Boosts });
  // 并发请求只让一个生效
  const [updated] = await db
    .update(profiles)
    .set({ dailyNew: profile.adaptive ? r.dailyNew : profile.dailyNew, boosts: r.boosts, adaptedOn: today })
    .where(and(eq(profiles.userId, userId), or(isNull(profiles.adaptedOn), ne(profiles.adaptedOn, today))))
    .returning();
  return updated ?? (await getProfile(userId));
}
