ALTER TABLE "documentation_records" ADD COLUMN "ehr_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "ehr_sync_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "ehr_sync_next_retry_at" timestamp with time zone;