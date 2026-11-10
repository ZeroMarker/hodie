import "server-only";
import { and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, dailyStats } from "@/db/app-schema";
import { type WordCard, getWordCard } from "@/modules/vocab/card";
import { dayEnd, studyDay } from "./day";
import { type FormOwners, clozeFor, wordForms } from "./forms";
import { type Exercise, isChoice } from "./grade";
import { pickNonInterfering } from "./interference";
import { posTag, shortMeaning } from "./meaning";
import { getAdaptedProfile } from "./adapt";
import { type Boosts, listenRate } from "./adapt-rules";
import { NEXT_LIST, type ListCode, getCutoff, getProfile, setList } from "./profile";
import { recentMistakes } from "./mistakes";
import { type CardState, State, exerciseFor, isLeech, isRelearning, levelFor } from "./schedule";
import {
  type Sentence,
  type WordRow,
  clozeSentences,
  intArray,
  distractorPool,
  formOwners,
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
  /** leech 卡片的重学:先看词卡再答题 */
  relearn?: boolean;
  level: number;
  exercise: Exercise;
  word: string;
  phonetic: string | null;
  meaning: string;
  /** 新词先展示的词卡内容 */
  card?: Pick<WordCard, "translations" | "examples" | "collocations" | "cefr" | "lists"> & {
    /** 词源讲解,只在重学时展示 */
    etymology: string | null;
  };
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

/** 出题需要的词库数据,一次查齐。 */
interface Context {
  rows: Map<number, WordRow>;
  pool: WordRow[];
  sentences: Map<number, Sentence[]>;
  owners: FormOwners;
  /** 选择题干扰项要排除的词:同义近义词和当天新词 */
  excludeFor: (id: number) => Set<number>;
  boosts: Boosts;
  today: string;
}

async function loadContext(
  list: string,
  ids: number[],
  boosts: Boosts,
  today: string,
  newIds = new Set<number>(),
): Promise<Context> {
  const [rows, pool, related, sentences, owners] = await Promise.all([
    wordsByIds(ids),
    distractorPool(list),
    relatedPairs(ids),
    clozeSentences(ids.filter((id) => !newIds.has(id))),
    formOwners(),
  ]);
  return {
    rows,
    pool,
    sentences,
    owners,
    excludeFor: (id) => new Set([...newIds, ...(related.get(id) ?? [])]),
    boosts,
    today,
  };
}

/** 词卡内容(新词和重学时先展示);例句避开同形异义词形。 */
async function cardContent(w: WordRow, owners: FormOwners, withEtymology = false): Promise<QueueItem["card"]> {
  const full = await getWordCard(w.id);
  if (!full) return undefined;
  const forms = wordForms(w.word, w.exchange);
  const examples = full.examples.filter((e) => clozeFor(e.textEn, e.source.startsWith("ai:"), w.id, forms, owners));
  return {
    translations: full.translations,
    examples: examples.slice(0, 2),
    collocations: full.collocations,
    cefr: full.cefr,
    lists: full.lists,
    etymology: withEtymology ? (full.etymology?.text ?? null) : null,
  };
}

/** 已有卡片的一道题:按级别出题;leech 卡片在重学阶段先看词卡(附词源),再做选择题。 */
async function reviewItem(c: typeof cards.$inferSelect, ctx: Context): Promise<QueueItem | null> {
  const w = ctx.rows.get(c.wordId);
  if (!w) return null;
  const level = levelFor(c as CardState);
  const relearn = isRelearning(c);
  let exercise = relearn ? "choice" : exerciseFor(level, Math.random(), listenRate(level, ctx.boosts, ctx.today));
  let cloze: QueueItem["cloze"];
  if (exercise === "cloze") {
    const forms = wordForms(w.word, w.exchange);
    for (const s of ctx.sentences.get(w.id) ?? []) {
      const z = clozeFor(s.en, s.senseMatched, w.id, forms, ctx.owners);
      if (z) {
        cloze = { ...z, hint: s.zh, first: z.answer[0], length: z.answer.length };
        break;
      }
    }
    // 找不到含目标词的例句时退回选择题
    if (!cloze) exercise = "choice";
  }
  return {
    key: c.id,
    wordId: c.wordId,
    senseId: c.senseId,
    isNew: false,
    relearn,
    level,
    word: w.word,
    phonetic: w.phonetic,
    meaning: shortMeaning(w.translation_zh, w.core_sense_id),
    exercise,
    cloze,
    card: relearn ? await cardContent(w, ctx.owners, true) : undefined,
    choice: isChoice(exercise) ? buildChoice(w, pickDistractors(w, ctx.pool, ctx.excludeFor(w.id))) : undefined,
  };
}

/** 今天的学习队列:到期卡片(上限 100,按到期先后)加上今天剩余的新词。 */
export async function getQueue(userId: string, now = new Date()): Promise<Queue | null> {
  const profile = await getAdaptedProfile(userId, now);
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
  const newWords = await pickAcrossLists(userId, profile.list as ListCode, newLimit - newToday, now);

  const newIds = new Set(newWords.map((w) => w.id));
  const ctx = await loadContext(
    profile.list,
    [...due.map((c) => c.wordId), ...newIds],
    profile.boosts as Boosts,
    today,
    newIds,
  );
  const items = (await Promise.all(due.map((c) => reviewItem(c, ctx)))).filter((i) => i !== null);
  const contents = await Promise.all(newWords.map((w) => cardContent(w, ctx.owners)));
  newWords.forEach((w, i) => {
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
      card: contents[i],
      choice: buildChoice(w, pickDistractors(w, ctx.pool, ctx.excludeFor(w.id))),
    });
  });

  return { items, dueTotal, newToday, newLimit };
}

/**
 * 取新词;当前词书剩下的词都取完了(没有可学的词)时,自动换到下一本词书继续取,
 * 并把用户的词书改成下一本。
 */
async function pickAcrossLists(userId: string, list: ListCode, n: number, now: Date): Promise<WordRow[]> {
  const out: WordRow[] = [];
  for (let current = list; n - out.length > 0; ) {
    const { words, exhausted } = await pickNewWords(userId, current, n - out.length, now, out);
    out.push(...words);
    const next = NEXT_LIST[current];
    if (!exhausted || !next) break;
    current = next;
    await setList(userId, current);
  }
  return out;
}

/**
 * 按词书取新词:跳过已有卡片、测试判定已掌握的词和 picked 里已选的词,NGSL 词优先,再按词频,
 * 最后做干扰控制。exhausted 表示这本词书剩下的词已全部取出。
 */
async function pickNewWords(
  userId: string,
  list: string,
  n: number,
  now: Date,
  picked: WordRow[] = [],
): Promise<{ words: WordRow[]; exhausted: boolean }> {
  if (n <= 0) return { words: [], exhausted: false };
  const pickedIds = picked.map((w) => w.id);
  const cutoff = await getCutoff(userId);
  const { rows: candidates } = await db.execute<WordRow>(sql`
    SELECT w.id, w.word, w.phonetic, w.translation_zh, w.exchange, w.cefr, w.core_sense_id, w.freq_rank
    FROM vocab.word_lists l JOIN vocab.words w ON w.id = l.word_id
    WHERE l.list = ${list}
      AND w.translation_zh IS NOT NULL AND w.translation_zh <> ''
      AND (w.freq_rank IS NULL OR w.freq_rank > ${cutoff})
      AND NOT EXISTS (SELECT 1 FROM app.cards c WHERE c.user_id = ${userId} AND c.word_id = w.id)
      AND NOT (w.id = ANY(${intArray(pickedIds)}))
    ORDER BY (w.ngsl_rank IS NULL), w.freq_rank NULLS LAST, w.id
    LIMIT ${n * 5}`);

  // 今天已学的新词也参与冲突判断
  const dayStart = new Date(dayEnd(now).getTime() - 86400_000);
  const takenCards = await db
    .select({ wordId: cards.wordId })
    .from(cards)
    .where(and(eq(cards.userId, userId), gte(cards.createdAt, dayStart)));
  const taken = [...(await wordsByIds(takenCards.map((c) => c.wordId))).values(), ...picked];

  const ids = [...candidates.map((c) => c.id), ...taken.map((t) => t.id)];
  const [related, hypernyms] = await Promise.all([relatedPairs(ids), hypernymSets(ids)]);
  const chosen = pickNonInterfering(candidates, n, taken, related, hypernyms);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return {
    words: chosen.map((p) => byId.get(p.id)!),
    // 候选不到上限说明取到了词书末尾;全部选中则词书已无可学的词
    exhausted: candidates.length < n * 5 && chosen.length === candidates.length,
  };
}

/** 错题练习最多的词数。 */
export const PRACTICE_LIMIT = 20;

/**
 * 错题练习队列:最近答错的卡片按级别出题。练习不提交、不改变复习安排;
 * leech 卡片先看词卡。
 */
export async function getPracticeQueue(userId: string, now = new Date()): Promise<QueueItem[] | null> {
  const profile = await getProfile(userId);
  if (!profile) return null;
  const ids = (await recentMistakes(userId, now)).slice(0, PRACTICE_LIMIT).map((m) => m.cardId);
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(cards)
    .where(and(eq(cards.userId, userId), inArray(cards.id, ids)));
  const ctx = await loadContext(profile.list, rows.map((c) => c.wordId), profile.boosts as Boosts, studyDay(now));
  const items = await Promise.all(
    rows.map((c) => reviewItem({ ...c, state: isLeech(c) ? State.Relearning : c.state }, ctx)),
  );
  return items.filter((i) => i !== null);
}
