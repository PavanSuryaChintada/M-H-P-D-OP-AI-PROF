ALTER TYPE "public"."escalation_state" ADD VALUE 'ACKNOWLEDGED';--> statement-breakpoint
ALTER TYPE "public"."escalation_state" ADD VALUE 'OVERDUE';--> statement-breakpoint
ALTER TYPE "public"."event_status" ADD VALUE 'PROCESSING';--> statement-breakpoint
ALTER TYPE "public"."event_status" ADD VALUE 'DEAD';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "scheduled_for" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;