CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "risk_level" "risk_level";--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "follow_up_window_hours" integer;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "source_message_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_hospital_source_message_idx" ON "encounters" USING btree ("hospital_id","source_message_id");