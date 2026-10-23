
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// =====================================================
// ENUMS
// =====================================================

export const outcomeEnum = pgEnum("pcu_outcome", [
  "SUCCESS",
  "FAILED",
]);

export const classificationEnum = pgEnum(
  "pcu_classification",
  [
    "SUCCESS_SEBASTE",
    "SUCCESS_OTHER_CLINIC",
    "SUCCESS_NOT_ASSIGNED",
    "SUCCESS_NO_CLINIC",
    "FAILED",
    "MANUAL_REVIEW",
  ]
);

export const verificationEnum = pgEnum(
  "pcu_verification_status",
  [
    "PENDING",
    "IN_REVIEW",
    "VERIFIED",
    "NEEDS_CORRECTION",
    "UNRESOLVED",
  ]
);

// Tracks asynchronous AI extraction.
export const aiStatusEnum = pgEnum("pcu_ai_status", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
]);

// =====================================================
// PCU SUBMISSIONS
// =====================================================

export const pcuSubmissions = pgTable(
  "pcu_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    barangay: varchar("barangay", {
      length: 100,
    }).notNull(),

    submittedOutcome: outcomeEnum(
      "submitted_outcome"
    ).notNull(),

    // -------------------------------------------------
    // PATIENT INFORMATION
    // -------------------------------------------------

    firstName: varchar("first_name", {
      length: 100,
    }),

    middleName: varchar("middle_name", {
      length: 100,
    }),

    lastName: varchar("last_name", {
      length: 100,
    }),

    birthDate: date("birth_date"),

    transactionNumber: varchar(
      "transaction_number",
      { length: 100 }
    ),

    errorCode: varchar("error_code", {
      length: 100,
    }),

    extractedPin: varchar("extracted_pin", {
      length: 30,
    }),

    verifiedPin: varchar("verified_pin", {
      length: 30,
    }),

    assignedClinic: text("assigned_clinic"),

    // -------------------------------------------------
    // PRIVATE SCREENSHOT STORAGE
    // -------------------------------------------------

    screenshotKey: text(
      "screenshot_key"
    ).notNull(),

    ocrRawText: text("ocr_raw_text"),

    // -------------------------------------------------
    // CLASSIFICATION AND RHU VERIFICATION
    // -------------------------------------------------

    classification: classificationEnum(
      "classification"
    )
      .notNull()
      .default("MANUAL_REVIEW"),

    verificationStatus: verificationEnum(
      "verification_status"
    )
      .notNull()
      .default("PENDING"),

    sheetSyncStatus: varchar(
      "sheet_sync_status",
      { length: 20 }
    )
      .notNull()
      .default("PENDING"),

    // -------------------------------------------------
    // PRIVATE AI WORKER QUEUE
    // -------------------------------------------------

    aiStatus: aiStatusEnum("ai_status")
      .notNull()
      .default("PENDING"),

    // Number of times a worker claimed the job.
    aiAttempts: integer("ai_attempts")
      .notNull()
      .default(0),

    // Unique token assigned to the current claim.
    // Must be checked by the result endpoint.
    aiLeaseToken: uuid("ai_lease_token"),

    // Expiration of the current worker claim.
    aiLeaseExpiresAt: timestamp(
      "ai_lease_expires_at",
      { withTimezone: true }
    ),

    // Time AI extraction was successfully completed.
    aiProcessedAt: timestamp(
      "ai_processed_at",
      { withTimezone: true }
    ),

    // Safe internal error code only.
    // Never store sensitive exception details here.
    aiLastError: varchar("ai_last_error", {
      length: 100,
    }),

    // -------------------------------------------------
    // TIMESTAMPS
    // -------------------------------------------------

    submittedAt: timestamp("submitted_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("pcu_barangay_idx").on(
      table.barangay
    ),

    index("pcu_submission_date_idx").on(
      table.submittedAt
    ),

    index("pcu_transaction_idx").on(
      table.transactionNumber
    ),

    index("pcu_ai_queue_idx").on(
      table.aiStatus,
      table.submittedAt
    ),

    index("pcu_ai_lease_idx").on(
      table.aiStatus,
      table.aiLeaseExpiresAt
    ),
  ]
);

// =====================================================
// REGISTRATION CASES
// =====================================================

export const registrationCases = pgTable(
  "registration_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    submissionId: uuid("submission_id")
      .notNull()
      .references(() => pcuSubmissions.id),

    registrationType: varchar(
      "registration_type",
      { length: 20 }
    ),

    status: varchar("status", {
      length: 40,
    })
      .notNull()
      .default("PENDING_ASSESSMENT"),

    notes: text("notes"),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex(
      "registration_submission_unique"
    ).on(table.submissionId),
  ]
);

// =====================================================
// AUDIT LOGS
// =====================================================

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    submissionId: uuid(
      "submission_id"
    ).references(() => pcuSubmissions.id),

    action: varchar("action", {
      length: 100,
    }).notNull(),

    actor: varchar("actor", {
      length: 100,
    }).notNull(),

    details: text("details"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  }
);
