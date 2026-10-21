import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { placement } from "@/db/app-schema";
import { shortMeaning } from "./meaning";
import { BAND_QUESTIONS, BAND_SIZE, type BandResult, MAX_BANDS } from "./placement-rules";
import { buildChoice, pickDistractors } from "./queue";
import type { WordRow } from "./words";

export interface PlacementQuestion {
  wordId: number;
  word: string;
  options: string[];
  answer: number;
}

/** 一档的题目:该档词频范围内、属于任一词书的随机 5 个词,干扰项取同档的其他词。 */
export async function bandQuestions(band: number): Promise<PlacementQuestion[]> {
  if (!Number.isInteger(band) || band < 1 || band > MAX_BANDS) throw new Error("档位无效");
  const lo = (band - 1) * BAND_SIZE + 1;
  const hi = band * BAND_SIZE;
  const { rows } = await db.execute<WordRow>(sql`
    SELECT w.id, w.word, w.phonetic, w.translation_zh, w.exchange, w.cefr, w.core_sense_id, w.freq_rank
    FROM vocab.words w
    WHERE w.freq_rank BETWEEN ${lo} AND ${hi}
      AND w.translation_zh IS NOT NULL AND w.translation_zh <> ''
      AND EXISTS (SELECT 1 FROM vocab.word_lists l WHERE l.word_id = w.id)
    ORDER BY random() LIMIT 60`);
  const targets = rows.filter((r) => shortMeaning(r.translation_zh, r.core_sense_id)).slice(0, BAND_QUESTIONS);
  const pool = rows.slice(BAND_QUESTIONS);
  return targets.map((t) => ({
    wordId: t.id,
    word: t.word,
    ...buildChoice(t, pickDistractors(t, pool, new Set(targets.map((x) => x.id)))),
  }));
}

export async function savePlacement(userId: string, results: BandResult[]) {
  const valid = results.filter(
    (r) =>
      Number.isInteger(r.band) &&
      r.band >= 1 &&
      r.band <= MAX_BANDS &&
      Number.isInteger(r.total) &&
      r.total > 0 &&
      r.total <= BAND_QUESTIONS &&
      Number.isInteger(r.known) &&
      r.known >= 0 &&
      r.known <= r.total,
  );
  await db.transaction(async (tx) => {
    await tx.delete(placement).where(eq(placement.userId, userId));
    if (valid.length) await tx.insert(placement).values(valid.map((r) => ({ userId, ...r })));
  });
}
