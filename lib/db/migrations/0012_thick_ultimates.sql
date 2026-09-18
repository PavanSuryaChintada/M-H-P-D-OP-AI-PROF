CREATE TYPE "public"."ehr_sync_status" AS ENUM('PENDING', 'SYNCED', 'FAILED');--> statement-breakpoint
CREATE TABLE "ehr_idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"operation" text NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "schema_version" text DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "patient_reported_symptoms" jsonb;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "observations_recorded" jsonb;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "questions_answered" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "questions_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "follow_up_actions" jsonb;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "ehr_sync_status" "ehr_sync_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "ehr_sync_error" text;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "model_provider" text;--> statement-breakpoint
ALTER TABLE "documentation_records" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "ehr_idempotency_records" ADD CONSTRAINT "ehr_idempotency_records_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ehr_idempotency_key_idx" ON "ehr_idempotency_records" USING btree ("hospital_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ehr_idempotency_hospital_idx" ON "ehr_idempotency_records" USING btree ("hospital_id");--> statement-breakpoint
ALTER TABLE "documentation_records" ADD CONSTRAINT "documentation_records_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;