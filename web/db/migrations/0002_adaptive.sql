ALTER TABLE "app"."profiles" ADD COLUMN "adaptive" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."profiles" ADD COLUMN "adapted_on" date;--> statement-breakpoint
ALTER TABLE "app"."profiles" ADD COLUMN "boosts" jsonb DEFAULT '{}'::jsonb NOT NULL;