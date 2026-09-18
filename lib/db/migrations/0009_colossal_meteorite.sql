ALTER TABLE "triage_results" ADD COLUMN "model_name" text;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "raw_output" jsonb;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "parsed_result" jsonb;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "retrieval_chunk_ids" jsonb;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "validation_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "triage_results" ADD COLUMN "estimated_cost_usd" numeric(10, 6);