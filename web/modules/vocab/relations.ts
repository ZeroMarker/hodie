import { sql } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { db } from "@/db";
import { splitTranslation } from "./card";

/** 关系里出现的词:id、词形、第一行中文释义、是否在词书里。 */
export interface RelatedWord {
  id: number;
  word: string;
  gloss: string;
  inList: boolean;
}

export interface Morpheme {
  form: string;
  kind: string;
  meaning: string | null;
  /** 含同一词素的其他词书词(只给不太泛滥的词素) */
  siblings: RelatedWord[];
}

export interface WordRelations {
  /** 同族词:WordNet 派生关系(库里两个方向都存了,只查 src 一侧即可走索引) */
  family: RelatedWord[];
  synonyms: RelatedWord[];
  antonyms: RelatedWord[];
  /** 上位词(属于哪一类) */
  hypernyms: RelatedWord[];
  morphemes: Morpheme[];
}

/** 词素用在这么多个词里以上(如 -er、-ly)就不列同根词,太泛,对记忆没有帮助。 */
const MAX_MORPHEME_USES = 150;

type Row = { id: number; word: string; translation_zh: string | null; in_list: boolean };

const toWord = (r: Row): RelatedWord => ({
  id: r.id,
  word: r.word,
  gloss: (splitTranslation(r.translation_zh)[0] ?? "").slice(0, 24),
  inList: r.in_list,
});

const WORD_COLS = sql`w.id, w.word, w.translation_zh,
  EXISTS (SELECT 1 FROM vocab.word_lists l WHERE l.word_id = w.id) AS in_list`;

/**
 * 词的关系(词库只读,缓存一天)。近义、反义、上位词只取核心义的关系,没有核心义的词取全部词义。
 * 每类先列词书词,再按词频。
 */
export async function getWordRelations(id: number, coreSenseId: string | null): Promise<WordRelations> {
  "use cache";
  cacheLife("days");

  const byType = async (types: string[], limit: number) => {
    const { rows } = await db.execute<Row & { core: boolean; freq_rank: number | null }>(sql`
      SELECT DISTINCT ON (w.id) ${WORD_COLS}, w.freq_rank, (r.src_sense_id = ${coreSenseId ?? ""}) AS core
      FROM vocab.relations r JOIN vocab.words w ON w.id = r.dst_word_id
      WHERE r.src_word_id = ${id} AND r.dst_word_id <> ${id} AND r.type = ANY(${sql.param(types)}::text[])
      ORDER BY w.id, (r.src_sense_id = ${coreSenseId ?? ""}) DESC`);
    // 有核心义时只取核心义的关系,否则会混进别的意思(如 bank 作动词时的 rely、depend)
    return rows
      .filter((r) => !coreSenseId || r.core)
      .sort((a, b) => Number(b.in_list) - Number(a.in_list) || rank(a) - rank(b))
      .slice(0, limit)
      .map(toWord);
  };

  const [family, synonyms, antonyms, hypernyms, morphemes] = await Promise.all([
    db
      .execute<Row & { freq_rank: number | null }>(sql`
        SELECT ${WORD_COLS}, w.freq_rank FROM vocab.words w
        WHERE w.id <> ${id} AND w.id IN (
          SELECT dst_word_id FROM vocab.relations WHERE type = 'derived_from' AND src_word_id = ${id})`)
      .then(({ rows }) =>
        rows.sort((a, b) => Number(b.in_list) - Number(a.in_list) || rank(a) - rank(b)).slice(0, 10).map(toWord),
      ),
    byType(["synonym", "similar"], 8),
    byType(["antonym"], 4),
    byType(["hypernym"], 3),
    getMorphemes(id),
  ]);
  return { family, synonyms, antonyms, hypernyms, morphemes };
}

const rank = (r: { freq_rank?: number | null }) => r.freq_rank ?? 1e9;

async function getMorphemes(id: number): Promise<Morpheme[]> {
  const { rows } = await db.execute<{ id: number; form: string; kind: string; meaning: string | null; uses: number }>(sql`
    SELECT m.id, m.form, m.kind, m.meaning,
           (SELECT count(*)::int FROM vocab.word_morphemes x WHERE x.morpheme_id = m.id) AS uses
    FROM vocab.word_morphemes wm JOIN vocab.morphemes m ON m.id = wm.morpheme_id
    WHERE wm.word_id = ${id}
      AND wm.etym_no = (SELECT min(etym_no) FROM vocab.word_morphemes WHERE word_id = ${id})
    ORDER BY wm.position`);
  return Promise.all(
    rows.map(async (m) => {
      if (m.uses > MAX_MORPHEME_USES) return { form: m.form, kind: m.kind, meaning: m.meaning, siblings: [] };
      const { rows: sib } = await db.execute<Row>(sql`
        SELECT ${WORD_COLS} FROM vocab.words w
        WHERE w.id <> ${id}
          AND w.id IN (SELECT word_id FROM vocab.word_morphemes WHERE morpheme_id = ${m.id})
          AND EXISTS (SELECT 1 FROM vocab.word_lists l WHERE l.word_id = w.id)
        ORDER BY w.freq_rank NULLS LAST LIMIT 6`);
      return { form: m.form, kind: m.kind, meaning: m.meaning, siblings: sib.map(toWord) };
    }),
  );
}
