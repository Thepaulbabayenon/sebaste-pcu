CREATE TYPE "public"."pcu_ai_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "ai_status" "pcu_ai_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "ai_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "ai_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "ai_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "ai_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "ai_last_error" varchar(100);--> statement-breakpoint
CREATE INDEX "pcu_ai_queue_idx" ON "pcu_submissions" USING btree ("ai_status","submitted_at");--> statement-breakpoint
CREATE INDEX "pcu_ai_lease_idx" ON "pcu_submissions" USING btree ("ai_status","ai_lease_expires_at");