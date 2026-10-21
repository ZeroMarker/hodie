import "server-only";
import { and, asc, count, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, dailyStats } from "@/db/app-schema";
import { type WordCard, getWordCard } from "@/modules/vocab/card";
import { dayEnd, studyDay } from "./day";
import { makeCloze, wordForms } from "./forms";
import type { Exercise } from "./grade";
import { pickNonInterfering } from "./interference";
import { posTag, shortMeaning } from "./meaning";
import { getCutoff, getProfile } from "./profile";
import { type CardState, exerciseFor, levelFor } from "./schedule";
import {
  type WordRow,
  clozeSentences,
  distractorPool,
  hypernymSets,
  relatedPairs,
  wordsByIds,
} from "./words";

export const REVIEW_LIMIT = 100;

export interface QueueItem {
  key: string;
  wordId: number;
  senseId: string;
  isNew: boolean;
  level: number;
  exercise: Exercise;
  word: string;
  phonetic: string | null;
  meaning: string;
  /** 新词先展示的词卡内容 */
  card?: Pick<WordCard, "translations" | "examples" | "collocations" | "cefr" | "lists">;
  choice?: { options: string[]; answer: number };
  cloze?: { before: string; after: string; answer: string; hint: string | null; first: string; length: number };
}

export interface Queue {
  items: QueueItem[];
  dueTotal: number;
  newToday: number;
  newLimit: number;
}

function cefrNear(a: string | null, b: string | null): boolean {
  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  if (!a || !b) return true;
  return Math.abs(order.indexOf(a) - order.indexOf(b)) <= 1;
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 选 3 个干扰项:词性相同、CEFR 相同或相邻,排除同义近义词和当天新词;不够时逐步放宽。 */
export function pickDistractors(
  target: WordRow,
  pool: WordRow[],
  exclude: Set<number>,
): string[] {
  const meaning = shortMeaning(target.translation_zh, target.core_sense_id);
  const pos = posTag(meaning);
  const seen = new Set([meaning]);
  const out: string[] = [];
  const tiers = [
    (w: WordRow, m: string) => posTag(m) === pos && cefrNear(w.cefr, target.cefr),
    (_: WordRow, m: string) => posTag(m) === pos,
    () => true,
  ];
  for (const ok of tiers) {
    for (const w of pool) {
      if (out.length >= 3) return out;
      if (w.id === target.id || exclude.has(w.id)) continue;
      const m = shortMeaning(w.translation_zh, w.core_sense_id);
      if (!m || seen.has(m) || !ok(w, m)) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

export function buildChoice(target: WordRow, distractors: string[]) {
  const meaning = shortMeaning(target.translation_zh, target.core_sense_id);
  const options = shuffle([meaning, ...distractors]);
  return { options, answer: options.indexOf(meaning) };
}

/** 今天的学习队列:到期卡片(上限 100,按到期先后)加上今天剩余的新词。 */
export async function getQueue(userId: string, now = new Date()): Promise<Queue | null> {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const today = studyDay(now);
  const end = dayEnd(now);

  const [due, [{ dueTotal }], [stat]] = await Promise.all([
    db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.suspended, 0), lte(cards.due, end)))
      .orderBy(asc(cards.due))
      .limit(REVIEW_LIMIT),
    db
      .select({ dueTotal: count() })
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.suspended, 0), lte(cards.due, end))),
    db
      .select()
      .from(dailyStats)
      .where(and(eq(dailyStats.userId, userId), eq(dailyStats.day, today))),
  ]);

  // 复习积压(到期数超过上限)时新词减半
  const newLimit = dueTotal > REVIEW_LIMIT ? Math.ceil(profile.dailyNew / 2) : profile.dailyNew;
  const newToday = stat?.newCount ?? 0;
  const newWords = await pickNewWords(userId, profile.list, newLimit - newToday, now);

  const ids = [...due.map((c) => c.wordId), ...newWords.map((w) => w.id)];
  const [rows, pool, related, sentences] = await Promise.all([
    wordsByIds(ids),
    distractorPool(profile.list),
    relatedPairs(ids),
    clozeSentences(due.map((c) => c.wordId)),
  ]);
  const newIds = new Set(newWords.map((w) => w.id));
  const excludeFor = (id: number) => new Set([...newIds, ...(related.get(id) ?? [])]);

  const items: QueueItem[] = [];
  for (const c of due) {
    const w = rows.get(c.wordId);
    if (!w) continue;
    const level = levelFor(c as CardState);
    let exercise = exerciseFor(level);
    const base = {
      key: c.id,
      wordId: c.wordId,
      senseId: c.senseId,
      isNew: false,
      level,
      word: w.word,
      phonetic: w.phonetic,
      meaning: shortMeaning(w.translation_zh, w.core_sense_id),
    };
    let cloze: QueueItem["cloze"];
    if (exercise === "cloze") {
      const forms = wordForms(w.word, w.exchange);
      for (const s of sentences.get(w.id) ?? []) {
        const z = makeCloze(s.en, forms);
        if (z) {
          cloze = { ...z, hint: s.zh, first: z.answer[0], length: z.answer.length };
          break;
        }
      }
      // 找不到含目标词的例句时退回选择题
      if (!cloze) exercise = "choice";
    }
    items.push({
      ...base,
      exercise,
      cloze,
      choice: exercise === "choice" ? buildChoice(w, pickDistractors(w, pool, excludeFor(w.id))) : undefined,
    });
  }

  const cardsContent = await Promise.all(newWords.map((w) => getWordCard(w.id)));
  newWords.forEach((w, i) => {
    const full = cardsContent[i];
    items.push({
      key: `new:${w.id}`,
      wordId: w.id,
      senseId: w.core_sense_id ?? "",
      isNew: true,
      level: 0,
      exercise: "choice",
      word: w.word,
      phonetic: w.phonetic,
      meaning: shortMeaning(w.translation_zh, w.core_sense_id),
      card: full
        ? {
            translations: full.translations,
            examples: full.examples.slice(0, 2),
            collocations: full.collocations,
            cefr: full.cefr,
            lists: full.lists,
          }
        : undefined,
      choice: buildChoice(w, pickDistractors(w, pool, excludeFor(w.id))),
    });
  });

  return { items, dueTotal, newToday, newLimit };
}

/** 按词书取新词:跳过已有卡片和测试判定已掌握的词,NGSL 词优先,再按词频,最后做干扰控制。 */
async function pickNewWords(userId: string, list: string, n: number, now: Date): Promise<WordRow[]> {
  if (n <= 0) return [];
  const cutoff = await getCutoff(userId);
  const { rows: candidates } = await db.execute<WordRow>(sql`
    SELECT w.id, w.word, w.phonetic, w.translation_zh, w.exchange, w.cefr, w.core_sense_id, w.freq_rank
    FROM vocab.word_lists l JOIN vocab.words w ON w.id = l.word_id
    WHERE l.list = ${list}
      AND w.translation_zh IS NOT NULL AND w.translation_zh <> ''
      AND (w.freq_rank IS NULL OR w.freq_rank > ${cutoff})
      AND NOT EXISTS (SELECT 1 FROM app.cards c WHERE c.user_id = ${userId} AND c.word_id = w.id)
    ORDER BY (w.ngsl_rank IS NULL), w.freq_rank NULLS LAST, w.id
    LIMIT ${n * 5}`);

  // 今天已学的新词也参与冲突判断
  const dayStart = new Date(dayEnd(now).getTime() - 86400_000);
  const takenCards = await db
    .select({ wordId: cards.wordId })
    .from(cards)
    .where(and(eq(cards.userId, userId), gte(cards.createdAt, dayStart)));
  const taken = await wordsByIds(takenCards.map((c) => c.wordId));

  const ids = [...candidates.map((c) => c.id), ...taken.keys()];
  const [related, hypernyms] = await Promise.all([relatedPairs(ids), hypernymSets(ids)]);
  const picked = pickNonInterfering(candidates, n, [...taken.values()], related, hypernyms);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return picked.map((p) => byId.get(p.id)!);
}
