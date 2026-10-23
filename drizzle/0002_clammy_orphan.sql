CREATE TYPE "public"."pcu_classification" AS ENUM('SUCCESS_SEBASTE', 'SUCCESS_OTHER_CLINIC', 'SUCCESS_NOT_ASSIGNED', 'SUCCESS_NO_CLINIC', 'FAILED', 'MANUAL_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."pcu_outcome" AS ENUM('SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pcu_verification_status" AS ENUM('PENDING', 'IN_REVIEW', 'VERIFIED', 'NEEDS_CORRECTION', 'UNRESOLVED');--> statement-breakpoint
DROP INDEX "pcu_submitted_at_idx";--> statement-breakpoint
ALTER TABLE "pcu_submissions" ALTER COLUMN "verification_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ALTER COLUMN "verification_status" SET DATA TYPE "public"."pcu_verification_status" USING "verification_status"::text::"public"."pcu_verification_status";--> statement-breakpoint
ALTER TABLE "pcu_submissions" ALTER COLUMN "verification_status" SET DEFAULT 'PENDING';--> statement-breakpoint
ALTER TABLE "registration_cases" ALTER COLUMN "status" SET DATA TYPE varchar(40);--> statement-breakpoint
ALTER TABLE "registration_cases" ALTER COLUMN "status" SET DEFAULT 'PENDING_ASSESSMENT';--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "submitted_outcome" "pcu_outcome" NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "first_name" varchar(100);--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "middle_name" varchar(100);--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "last_name" varchar(100);--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "extracted_pin" varchar(30);--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "verified_pin" varchar(30);--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "classification" "pcu_classification" DEFAULT 'MANUAL_REVIEW' NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "sheet_sync_status" varchar(20) DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_cases" ADD COLUMN "registration_type" varchar(20);--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_submission_id_pcu_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."pcu_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pcu_submission_date_idx" ON "pcu_submissions" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "pcu_transaction_idx" ON "pcu_submissions" USING btree ("transaction_number");--> statement-breakpoint
ALTER TABLE "audit_logs" DROP COLUMN "entity_id";--> statement-breakpoint
ALTER TABLE "pcu_submissions" DROP COLUMN "full_name";--> statement-breakpoint
ALTER TABLE "pcu_submissions" DROP COLUMN "pcu_result";--> statement-breakpoint
ALTER TABLE "registration_cases" DROP COLUMN "verified_pin";--> statement-breakpoint
DROP TYPE "public"."pcu_result";--> statement-breakpoint
DROP TYPE "public"."registration_status";--> statement-breakpoint
DROP TYPE "public"."verification_status";