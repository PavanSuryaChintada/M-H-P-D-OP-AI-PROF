ALTER TABLE "knowledge_chunks" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "heading" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "protocol_version" integer;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "structured_content" jsonb;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "specialty" text;--> statement-breakpoint
ALTER TABLE "protocols" ADD COLUMN "effective_from" timestamp with time zone;