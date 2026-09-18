ALTER TYPE "public"."outreach_task_state" ADD VALUE 'INVALID_NUMBER' BEFORE 'RETRY_SCHEDULED';--> statement-breakpoint
ALTER TYPE "public"."outreach_task_state" ADD VALUE 'DECLINED' BEFORE 'RETRY_SCHEDULED';--> statement-breakpoint
ALTER TYPE "public"."outreach_task_state" ADD VALUE 'ELIGIBILITY_ERROR';--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "outcome" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."call_outcome";--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('COMPLETED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'DROPPED', 'INVALID_NUMBER', 'DECLINED', 'CALLBACK_REQUESTED', 'ESCALATED', 'NETWORK_FAILURE', 'PROVIDER_ERROR', 'MANUAL_FOLLOW_UP');--> statement-breakpoint
ALTER TABLE "calls" ALTER COLUMN "outcome" SET DATA TYPE "public"."call_outcome" USING "outcome"::"public"."call_outcome";--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "attempt_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "partial_state" jsonb;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD COLUMN "last_error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_task_attempt_idx" ON "calls" USING btree ("outreach_task_id","attempt_number");