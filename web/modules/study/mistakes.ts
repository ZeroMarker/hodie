import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { shortMeaning } from "./meaning";
import { isLeech } from "./schedule";

/** 错题本统计的天数。 */
export const MISTAKE_DAYS = 30;

export interface Mistake {
  cardId: string;
  wordId: number;
  word: string;
  meaning: string;
  /** 统计期内答错次数 */
  wrong: number;
  lastWrong: Date;
  /** 累计遗忘次数 */
  lapses: number;
  leech: boolean;
  due: Date;
}

/** 最近 MISTAKE_DAYS 天答错过的词(评分为 Again),最近答错的在前,至多 200 个。 */
export async function recentMistakes(userId: string, now = new Date()): Promise<Mistake[]> {
  const since = new Date(now.getTime() - MISTAKE_DAYS * 86400_000);
  const { rows } = await db.execute<{
    card_id: string;
    word_id: number;
    word: string;
    translation_zh: string | null;
    core_sense_id: string | null;
    wrong: number;
    last_wrong: string;
    lapses: number;
    due: string;
  }>(sql`
    SELECT c.id AS card_id, c.word_id, w.word, w.translation_zh, w.core_sense_id,
           m.wrong, m.last_wrong, c.lapses, c.due
    FROM (
      SELECT card_id, count(*)::int AS wrong, max(reviewed_at) AS last_wrong
      FROM app.review_logs
      WHERE user_id = ${userId} AND rating = 1 AND reviewed_at >= ${since.toISOString()}
      GROUP BY card_id
    ) m
    JOIN app.cards c ON c.id = m.card_id
    JOIN vocab.words w ON w.id = c.word_id
    ORDER BY m.last_wrong DESC
    LIMIT 200`);
  return rows.map((r) => ({
    cardId: r.card_id,
    wordId: r.word_id,
    word: r.word,
    meaning: shortMeaning(r.translation_zh, r.core_sense_id),
    wrong: r.wrong,
    lastWrong: new Date(r.last_wrong),
    lapses: r.lapses,
    leech: isLeech(r),
    due: new Date(r.due),
  }));
}
