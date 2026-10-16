import { and, asc, desc, eq } from "drizzle-orm";
import { cacheLife } from "next/cache";
import { db } from "@/db";
import {
  collocations,
  etymologyNotes,
  examples,
  senses,
  wordLists,
  words,
} from "@/db/vocab-schema";

export type WordCard = NonNullable<Awaited<ReturnType<typeof getWordCard>>>;

const LIST_NAMES: Record<string, string> = {
  zk: "中考",
  gk: "高考",
  cet4: "CET-4",
  cet6: "CET-6",
  ky: "考研",
  ielts: "雅思",
  toefl: "托福",
  gre: "GRE",
  ngsl: "NGSL",
};

/** ECDICT 的中文释义按行拆开,去掉空行。 */
export function splitTranslation(zh: string | null): string[] {
  return (zh ?? "")
    .split(/\\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function listName(list: string): string {
  return LIST_NAMES[list] ?? list;
}

// 词库只在 load_pg.py 重建时变化,缓存一天。
export async function getWordCard(id: number) {
  "use cache";
  cacheLife("days");
  const [word] = await db.select().from(words).where(eq(words.id, id));
  if (!word) return null;

  const [lists, exs, cols, notes, core] = await Promise.all([
    db.select({ list: wordLists.list }).from(wordLists).where(eq(wordLists.wordId, id)),
    db
      .select()
      .from(examples)
      .where(eq(examples.wordId, id))
      .orderBy(desc(examples.reviewed), asc(examples.id))
      .limit(3),
    db
      .select({ phrase: collocations.phrase, source: collocations.source })
      .from(collocations)
      .where(eq(collocations.wordId, id))
      .orderBy(desc(collocations.logDice))
      .limit(5),
    db.select().from(etymologyNotes).where(eq(etymologyNotes.wordId, id)),
    word.coreSenseId
      ? db
          .select()
          .from(senses)
          .where(and(eq(senses.id, word.coreSenseId), eq(senses.wordId, id)))
      : Promise.resolve([]),
  ]);

  return {
    ...word,
    translations: splitTranslation(word.translationZh),
    lists: lists.map((l) => l.list),
    examples: exs,
    collocations: cols,
    etymology: notes[0] ?? null,
    coreSense: core[0] ?? null,
  };
}
