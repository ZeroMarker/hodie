// app schema:用户数据,由 drizzle-kit 迁移管理。
// 不对 vocab 建外键(load_pg.py 用 DROP SCHEMA ... CASCADE 替换词库),
// 引用一致性由 scripts/check-refs.ts 检查。
import type { AdapterAccountType } from "next-auth/adapters";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");

// Auth.js 标准表(@auth/drizzle-adapter 的 PostgreSQL 结构)。
export const users = app.table("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
});

export const accounts = app.table(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = app.table("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = app.table(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// 以下表的 user_id 即 users.id;为了账号删除时逐表清理,不建外键。

export const profiles = app.table("profiles", {
  userId: text("user_id").primaryKey(),
  list: text("list").notNull().default("ngsl"),
  dailyNew: smallint("daily_new").notNull().default(10),
  retention: real("retention").notNull().default(0.9),
  fsrsParams: jsonb("fsrs_params").$type<number[] | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const placement = app.table(
  "placement",
  {
    userId: text("user_id").notNull(),
    band: smallint("band").notNull(),
    known: smallint("known").notNull(),
    total: smallint("total").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.band] })],
);

export const cards = app.table(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    wordId: integer("word_id").notNull(),
    // 空串表示词条的核心义没有对应的 WordNet 词义,用空串而非 NULL 以便唯一键生效
    senseId: text("sense_id").notNull().default(""),
    level: smallint("level").notNull().default(0),
    due: timestamp("due", { withTimezone: true }).notNull(),
    stability: real("stability").notNull().default(0),
    difficulty: real("difficulty").notNull().default(0),
    // ts-fsrs 短期学习步骤的位置(学习和重学阶段)
    learningSteps: smallint("learning_steps").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    state: smallint("state").notNull().default(0),
    lastReview: timestamp("last_review", { withTimezone: true }),
    suspended: smallint("suspended").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cards_user_word_sense").on(t.userId, t.wordId, t.senseId),
    index("cards_user_due").on(t.userId, t.due),
  ],
);

export const reviewLogs = app.table(
  "review_logs",
  {
    // 客户端生成,离线同步时用于去重
    id: uuid("id").primaryKey(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    exercise: text("exercise").notNull(),
    level: smallint("level").notNull(),
    rating: smallint("rating").notNull(),
    durationMs: integer("duration_ms").notNull(),
    answer: text("answer"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    stabilityBefore: real("stability_before"),
    difficultyBefore: real("difficulty_before"),
    stabilityAfter: real("stability_after").notNull(),
    difficultyAfter: real("difficulty_after").notNull(),
    elapsedDays: real("elapsed_days"),
  },
  (t) => [index("review_logs_user_time").on(t.userId, t.reviewedAt)],
);

export const dailyStats = app.table(
  "daily_stats",
  {
    userId: text("user_id").notNull(),
    day: date("day").notNull(),
    newCount: smallint("new_count").notNull().default(0),
    reviewCount: smallint("review_count").notNull().default(0),
    correctCount: smallint("correct_count").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const conversations = app.table("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  scenario: text("scenario").notNull(),
  difficulty: smallint("difficulty").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = app.table(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    corrections: jsonb("corrections"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation").on(t.conversationId, t.createdAt)],
);

export const aiUsage = app.table(
  "ai_usage",
  {
    userId: text("user_id").notNull(),
    day: date("day").notNull(),
    feature: text("feature").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.feature] })],
);

export const aiCache = app.table("ai_cache", {
  hash: text("hash").primaryKey(),
  result: jsonb("result").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
