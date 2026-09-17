CREATE TYPE "public"."hospital_status" AS ENUM('CREATED', 'CONFIGURED', 'READY');--> statement-breakpoint
CREATE TABLE "escalation_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hospital_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"role" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"contact_value" text NOT NULL,
	"ack_timeout_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-edited from drizzle-kit's generated output: existing rows may carry
-- doc 01's old status value ('DRAFT'), which isn't a label in the new
-- hospital_status enum, and a blind cast would fail the whole migration.
-- Map it to the closest new-lifecycle equivalent instead.
ALTER TABLE "hospitals" ALTER COLUMN "status" SET DEFAULT 'CREATED'::"public"."hospital_status";--> statement-breakpoint
ALTER TABLE "hospitals" ALTER COLUMN "status" SET DATA TYPE "public"."hospital_status" USING (
  CASE "status" WHEN 'DRAFT' THEN 'CREATED' ELSE "status" END
)::"public"."hospital_status";--> statement-breakpoint
-- Also hand-edited: short_code is NOT NULL, but existing rows predate the
-- column. Add it nullable, backfill from each row's id, then tighten.
ALTER TABLE "hospitals" ADD COLUMN "short_code" text;--> statement-breakpoint
UPDATE "hospitals" SET "short_code" = 'LEGACY-' || substr("id"::text, 1, 8) WHERE "short_code" IS NULL;--> statement-breakpoint
ALTER TABLE "hospitals" ALTER COLUMN "short_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "hospitals" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "escalation_contacts" ADD CONSTRAINT "escalation_contacts_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalation_contacts_hospital_idx" ON "escalation_contacts" USING btree ("hospital_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_contacts_hospital_order_idx" ON "escalation_contacts" USING btree ("hospital_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "hospitals_short_code_idx" ON "hospitals" USING btree ("short_code");