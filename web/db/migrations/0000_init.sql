CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."ai_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."ai_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"feature" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_user_id_day_feature_pk" PRIMARY KEY("user_id","day","feature")
);
--> statement-breakpoint
CREATE TABLE "app"."cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"word_id" integer NOT NULL,
	"sense_id" text DEFAULT '' NOT NULL,
	"level" smallint DEFAULT 0 NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" real DEFAULT 0 NOT NULL,
	"difficulty" real DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" smallint DEFAULT 0 NOT NULL,
	"last_review" timestamp with time zone,
	"suspended" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"scenario" text NOT NULL,
	"difficulty" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."daily_stats" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"new_count" smallint DEFAULT 0 NOT NULL,
	"review_count" smallint DEFAULT 0 NOT NULL,
	"correct_count" smallint DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_stats_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"corrections" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."placement" (
	"user_id" text NOT NULL,
	"band" smallint NOT NULL,
	"known" smallint NOT NULL,
	"total" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placement_user_id_band_pk" PRIMARY KEY("user_id","band")
);
--> statement-breakpoint
CREATE TABLE "app"."profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"list" text DEFAULT 'ngsl' NOT NULL,
	"daily_new" smallint DEFAULT 10 NOT NULL,
	"retention" real DEFAULT 0.9 NOT NULL,
	"fsrs_params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."review_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"exercise" text NOT NULL,
	"level" smallint NOT NULL,
	"rating" smallint NOT NULL,
	"duration_ms" integer NOT NULL,
	"answer" text,
	"reviewed_at" timestamp with time zone NOT NULL,
	"stability_before" real,
	"difficulty_before" real,
	"stability_after" real NOT NULL,
	"difficulty_after" real NOT NULL,
	"elapsed_days" real
);
--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "app"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "app"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_user_word_sense" ON "app"."cards" USING btree ("user_id","word_id","sense_id");--> statement-breakpoint
CREATE INDEX "cards_user_due" ON "app"."cards" USING btree ("user_id","due");--> statement-breakpoint
CREATE INDEX "messages_conversation" ON "app"."messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "review_logs_user_time" ON "app"."review_logs" USING btree ("user_id","reviewed_at");