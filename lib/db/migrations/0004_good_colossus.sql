CREATE TYPE "public"."eligibility_status" AS ENUM('ELIGIBLE', 'INELIGIBLE', 'ERROR');--> statement-breakpoint
CREATE TABLE "campaign_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"hospital_id" uuid NOT NULL,
	"from_state" "campaign_state",
	"to_state" "campaign_state" NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eligibility_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" "eligibility_status" NOT NULL,
	"rule_results" jsonb,
	"error_message" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "protocol_id" uuid;--> statement-breakpoint
ALTER TABLE "campaign_state_transitions" ADD CONSTRAINT "campaign_state_transitions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_state_transitions" ADD CONSTRAINT "campaign_state_transitions_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_state_transitions_campaign_idx" ON "campaign_state_transitions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "eligibility_evaluations_campaign_idx" ON "eligibility_evaluations" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eligibility_evaluations_campaign_patient_idx" ON "eligibility_evaluations" USING btree ("campaign_id","patient_id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_protocol_id_protocols_id_fk" FOREIGN KEY ("protocol_id") REFERENCES "public"."protocols"("id") ON DELETE no action ON UPDATE no action;