CREATE TYPE "public"."escalation_resolution_outcome" AS ENUM('contacted_patient', 'advised_self_care', 'booked_appointment', 'referred_to_emergency', 'no_action_needed_false_positive', 'unable_to_contact', 'other');--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "resolution_outcome" "escalation_resolution_outcome";--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "time_to_acknowledge_seconds" integer;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "time_to_resolve_seconds" integer;