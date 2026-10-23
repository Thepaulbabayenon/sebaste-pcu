CREATE TYPE "public"."pcu_result" AS ENUM('UNCLASSIFIED', 'SUCCESS_SEBASTE', 'SUCCESS_UNASSIGNED', 'SUCCESS_OTHER_CLINIC', 'SUCCESS_UNKNOWN_CLINIC', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('PENDING_ASSESSMENT', 'NOT_REQUIRED', 'PKRF_REQUIRED', 'PMRF_ASSESSMENT', 'DOCUMENT_PREPARATION', 'SENT_TO_CULASI', 'PROCESSING', 'REGISTERED', 'RETURNED_FOR_CORRECTION');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'IN_REVIEW', 'VERIFIED', 'NEEDS_CORRECTION', 'UNRESOLVED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"actor" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barangays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	CONSTRAINT "barangays_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"birth_date" date,
	"philhealth_pin" varchar(30),
	"barangay_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pcu_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"screenshot_key" text NOT NULL,
	"transaction_number" varchar(100),
	"error_code" varchar(100),
	"assigned_clinic" text,
	"ocr_raw_text" text,
	"result" "pcu_result" DEFAULT 'UNCLASSIFIED' NOT NULL,
	"verification" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"source_submission_id" uuid,
	"status" "registration_status" DEFAULT 'PENDING_ASSESSMENT' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_barangay_id_barangays_id_fk" FOREIGN KEY ("barangay_id") REFERENCES "public"."barangays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pcu_submissions" ADD CONSTRAINT "pcu_submissions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_cases" ADD CONSTRAINT "registration_cases_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_cases" ADD CONSTRAINT "registration_cases_source_submission_id_pcu_submissions_id_fk" FOREIGN KEY ("source_submission_id") REFERENCES "public"."pcu_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pcu_patient_idx" ON "pcu_submissions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "pcu_transaction_idx" ON "pcu_submissions" USING btree ("transaction_number");