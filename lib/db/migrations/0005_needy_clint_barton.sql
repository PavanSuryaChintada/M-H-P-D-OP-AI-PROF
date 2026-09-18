ALTER TABLE "outreach_tasks" ADD COLUMN "risk_level" "risk_level";--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD COLUMN "total_window_hours" integer;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD COLUMN "tier" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outreach_tasks_claim_order_idx" ON "outreach_tasks" USING btree ("hospital_id","state","tier","priority_score","created_at");--> statement-breakpoint
ALTER TABLE "hospital_capacity" ADD CONSTRAINT "hospital_capacity_bounds" CHECK ("hospital_capacity"."current_active_calls" >= 0 AND "hospital_capacity"."current_active_calls" <= "hospital_capacity"."max_concurrent_calls");