ALTER TABLE "ai_usage" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "validation_outcome" text;