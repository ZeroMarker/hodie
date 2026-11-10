import "server-only";
import { sql } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { db } from "@/db";
import { type FormOwners, buildFormOwners, clozeFor, wordForms } from "./forms";

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

/** senseMatched:例句按核心义写成(AI 按核心义生成,或 WordNet 核心义自带的例句)。 */
export type Sentence = { en: string; zh: string | null; senseMatched: boolean };

/**
 * 挖空用的例句:优先已审核的例句(随机取至多 6 条),再加 WordNet 核心义的英文例句。
 * 是否含同形异义词形由调用方用 clozeFor 判断,所以多取几条备选。
 */
export async function clozeSentences(ids: number[]): Promise<Map<number, Sentence[]>> {
  const map = new Map<number, Sentence[]>();
  if (ids.length === 0) return map;
  const { rows } = await db.execute<{ word_id: number; en: string; zh: string | null; sense_matched: boolean }>(sql`
    SELECT word_id, en, zh, sense_matched FROM (
      SELECT e.word_id, e.text_en AS en, e.text_zh AS zh, e.source LIKE 'ai:%' AS sense_matched,
             row_number() OVER (PARTITION BY e.word_id ORDER BY e.reviewed DESC, random()) AS rn
      FROM vocab.examples e WHERE e.word_id = ANY(${intArray(ids)})
    ) t WHERE rn <= 6
    UNION ALL
    SELECT s.word_id, jsonb_array_elements_text(s.examples) AS en, NULL AS zh, true AS sense_matched
    FROM vocab.words w JOIN vocab.senses s ON s.id = w.core_sense_id AND s.word_id = w.id
    WHERE w.id = ANY(${intArray(ids)}) AND s.examples IS NOT NULL`);
  for (const r of rows) {
    if (!map.has(r.word_id)) map.set(r.word_id, []);
    map.get(r.word_id)!.push({ en: r.en, zh: r.zh, senseMatched: r.sense_matched });
  }
  return map;
}

// 词库只在 load_pg.py 重建时变化,缓存一天。缓存的值要能序列化,所以存成数组再转 Map。
async function formOwnerEntries(): Promise<[string, number[]][]> {
  "use cache";
  cacheLife("days");
  const { rows } = await db.execute<{ id: number; word: string; exchange: string | null }>(sql`
    SELECT w.id, w.word, w.exchange FROM vocab.words w
    WHERE EXISTS (SELECT 1 FROM vocab.word_lists l WHERE l.word_id = w.id)`);
  return [...buildFormOwners(rows)];
}

/** 全部词书词的词形归属,用于识别同形异义词形。 */
export async function formOwners(): Promise<FormOwners> {
  return new Map(await formOwnerEntries());
}

/**
 * 去掉例句和搭配里用了同形异义词形的条目(如 found 的例句里 found 作 find 的过去式)。
 * AI 生成的条目按核心义写成,全部保留。text 取例句英文或搭配短语。
 */
export function senseSafe<T extends { source: string }>(
  w: { id: number; word: string; exchange: string | null },
  items: T[],
  text: (t: T) => string,
  owners: FormOwners,
): T[] {
  const forms = wordForms(w.word, w.exchange);
  return items.filter((t) => clozeFor(text(t), t.source.startsWith("ai:"), w.id, forms, owners));
}
