import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type WordRow = {
  id: number;
  word: string;
  phonetic: string | null;
  translation_zh: string | null;
  exchange: string | null;
  cefr: string | null;
  core_sense_id: string | null;
  freq_rank: number | null;
};

/** 整数数组作为单个参数传入(drizzle 默认会把数组展开成多个参数)。 */
export const intArray = (ids: number[]) => sql`${sql.param(ids)}::int[]`;

const COLS = sql`w.id, w.word, w.phonetic, w.translation_zh, w.exchange, w.cefr, w.core_sense_id, w.freq_rank`;

export async function wordsByIds(ids: number[]): Promise<Map<number, WordRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.execute<WordRow>(
    sql`SELECT ${COLS} FROM vocab.words w WHERE w.id = ANY(${intArray(ids)})`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** 干扰项候选:同一词书里随机取一批有中文释义的词。 */
export async function distractorPool(list: string, n = 300): Promise<WordRow[]> {
  const { rows } = await db.execute<WordRow>(sql`
    SELECT ${COLS} FROM vocab.word_lists l JOIN vocab.words w ON w.id = l.word_id
    WHERE l.list = ${list} AND w.translation_zh IS NOT NULL AND w.translation_zh <> ''
    ORDER BY random() LIMIT ${n}`);
  return rows;
}

/** 同义或近义(synonym、similar)关系,双向合并。 */
export async function relatedPairs(ids: number[]): Promise<Map<number, Set<number>>> {
  const map = new Map<number, Set<number>>();
  if (ids.length === 0) return map;
  const { rows } = await db.execute<{ a: number; b: number }>(sql`
    SELECT src_word_id AS a, dst_word_id AS b FROM vocab.relations
    WHERE type IN ('synonym', 'similar') AND (src_word_id = ANY(${intArray(ids)}) OR dst_word_id = ANY(${intArray(ids)}))`);
  const add = (a: number, b: number) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const { a, b } of rows) {
    add(a, b);
    add(b, a);
  }
  return map;
}

export async function hypernymSets(ids: number[]): Promise<Map<number, Set<number>>> {
  const map = new Map<number, Set<number>>();
  if (ids.length === 0) return map;
  const { rows } = await db.execute<{ a: number; h: number }>(sql`
    SELECT DISTINCT src_word_id AS a, dst_word_id AS h FROM vocab.relations
    WHERE type = 'hypernym' AND src_word_id = ANY(${intArray(ids)})`);
  for (const { a, h } of rows) {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(h);
  }
  return map;
}

/** 挖空用的例句:优先 Tatoeba 和已审核的例句,没有时用 WordNet 核心义的英文例句。 */
export async function clozeSentences(
  ids: number[],
): Promise<Map<number, { en: string; zh: string | null }[]>> {
  const map = new Map<number, { en: string; zh: string | null }[]>();
  if (ids.length === 0) return map;
  const { rows } = await db.execute<{ word_id: number; en: string; zh: string | null }>(sql`
    SELECT word_id, en, zh FROM (
      SELECT e.word_id, e.text_en AS en, e.text_zh AS zh,
             row_number() OVER (PARTITION BY e.word_id ORDER BY e.reviewed DESC, random()) AS rn
      FROM vocab.examples e WHERE e.word_id = ANY(${intArray(ids)})
    ) t WHERE rn <= 3
    UNION ALL
    SELECT s.word_id, jsonb_array_elements_text(s.examples) AS en, NULL AS zh
    FROM vocab.words w JOIN vocab.senses s ON s.id = w.core_sense_id AND s.word_id = w.id
    WHERE w.id = ANY(${intArray(ids)}) AND s.examples IS NOT NULL`);
  for (const r of rows) {
    if (!map.has(r.word_id)) map.set(r.word_id, []);
    map.get(r.word_id)!.push({ en: r.en, zh: r.zh });
  }
  return map;
}
