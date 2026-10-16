// vocab schema 的只读定义,与 scripts/vocab/build.py 的建表语句对应。
// 该 schema 由 load_pg.py 整体替换,这里不生成迁移。
import { integer, jsonb, pgSchema, real, text } from "drizzle-orm/pg-core";

export const vocab = pgSchema("vocab");

export const words = vocab.table("words", {
  id: integer("id").primaryKey(),
  word: text("word").notNull(),
  phonetic: text("phonetic"),
  definitionEn: text("definition_en"),
  translationZh: text("translation_zh"),
  pos: text("pos"),
  exchange: text("exchange"),
  cefr: text("cefr"),
  freqRank: integer("freq_rank"),
  zipf: real("zipf"),
  ngslRank: integer("ngsl_rank"),
  coreSenseId: text("core_sense_id"),
  concrete: integer("concrete").notNull(),
});

export const wordLists = vocab.table("word_lists", {
  list: text("list").notNull(),
  wordId: integer("word_id").notNull(),
});

export const senses = vocab.table("senses", {
  id: text("id").primaryKey(),
  wordId: integer("word_id").notNull(),
  synsetId: text("synset_id").notNull(),
  pos: text("pos").notNull(),
  senseOrder: integer("sense_order").notNull(),
  definition: text("definition"),
  examples: jsonb("examples").$type<string[] | null>(),
  register: text("register"),
  lexfile: text("lexfile"),
});

export const examples = vocab.table("examples", {
  id: integer("id").primaryKey(),
  wordId: integer("word_id").notNull(),
  textEn: text("text_en").notNull(),
  textZh: text("text_zh").notNull(),
  audioUrl: text("audio_url"),
  source: text("source").notNull(),
  sourceId: text("source_id").notNull(),
  author: text("author"),
  license: text("license").notNull(),
  reviewed: integer("reviewed").notNull(),
});

export const collocations = vocab.table("collocations", {
  wordId: integer("word_id").notNull(),
  partnerId: integer("partner_id").notNull(),
  phrase: text("phrase").notNull(),
  freq: integer("freq"),
  logDice: real("log_dice"),
  source: text("source").notNull(),
});

export const relations = vocab.table("relations", {
  srcWordId: integer("src_word_id").notNull(),
  dstWordId: integer("dst_word_id").notNull(),
  type: text("type").notNull(),
  srcSenseId: text("src_sense_id").notNull(),
  source: text("source").notNull(),
});

export const etymologyNotes = vocab.table("etymology_notes", {
  wordId: integer("word_id").primaryKey(),
  text: text("text").notNull(),
  source: text("source").notNull(),
  reviewed: integer("reviewed").notNull(),
});
