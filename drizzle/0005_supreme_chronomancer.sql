ALTER TABLE "pcu_submissions"
ADD COLUMN IF NOT EXISTS "submitted_by" varchar(150);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pcu_submitted_by_idx"
ON "pcu_submissions" USING btree ("submitted_by");