CREATE TABLE "escalation_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"escalation_id" uuid NOT NULL,
	"assessor_id" text NOT NULL,
	"status" text NOT NULL,
	"classification" "triage_classification",
	"confidence" numeric(4, 3),
	"severity_rank" integer,
	"observed_indicators" jsonb,
	"evidence" jsonb,
	"prompt_version" text,
	"model_provider" text,
	"error_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "outreach_task_id" uuid;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "attempt_number" integer;--> statement-breakpoint
ALTER TABLE "escalation_assessments" ADD CONSTRAINT "escalation_assessments_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_assessments" ADD CONSTRAINT "escalation_assessments_escalation_id_escalations_id_fk" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalation_assessments_escalation_idx" ON "escalation_assessments" USING btree ("escalation_id");--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_outreach_task_id_outreach_tasks_id_fk" FOREIGN KEY ("outreach_task_id") REFERENCES "public"."outreach_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_task_attempt_idx" ON "escalations" USING btree ("outreach_task_id","attempt_number");