ALTER TABLE "barangays" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patients" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "barangays" CASCADE;--> statement-breakpoint
DROP TABLE "patients" CASCADE;--> statement-breakpoint
ALTER TABLE "pcu_submissions" DROP CONSTRAINT "pcu_submissions_patient_id_patients_id_fk";
--> statement-breakpoint
ALTER TABLE "registration_cases" DROP CONSTRAINT "registration_cases_patient_id_patients_id_fk";
--> statement-breakpoint
ALTER TABLE "registration_cases" DROP CONSTRAINT "registration_cases_source_submission_id_pcu_submissions_id_fk";
--> statement-breakpoint
DROP INDEX "pcu_patient_idx";--> statement-breakpoint
DROP INDEX "pcu_transaction_idx";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "barangay" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "full_name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "pcu_result" "pcu_result" DEFAULT 'UNCLASSIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "verification_status" "verification_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_cases" ADD COLUMN "submission_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_cases" ADD COLUMN "verified_pin" varchar(30);--> statement-breakpoint
ALTER TABLE "registration_cases" ADD CONSTRAINT "registration_cases_submission_id_pcu_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."pcu_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pcu_barangay_idx" ON "pcu_submissions" USING btree ("barangay");--> statement-breakpoint
CREATE INDEX "pcu_submitted_at_idx" ON "pcu_submissions" USING btree ("submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registration_submission_unique" ON "registration_cases" USING btree ("submission_id");--> statement-breakpoint
ALTER TABLE "pcu_submissions" DROP COLUMN "patient_id";--> statement-breakpoint
ALTER TABLE "pcu_submissions" DROP COLUMN "result";--> statement-breakpoint
ALTER TABLE "pcu_submissions" DROP COLUMN "verification";--> statement-breakpoint
ALTER TABLE "registration_cases" DROP COLUMN "patient_id";--> statement-breakpoint
ALTER TABLE "registration_cases" DROP COLUMN "source_submission_id";