
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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

    screenshotKey: text(
      "screenshot_key"
    ).notNull(),

    ocrRawText: text("ocr_raw_text"),

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
    index("pcu_barangay_idx").on(table.barangay),
    index("pcu_submission_date_idx").on(
      table.submittedAt
    ),
    index("pcu_transaction_idx").on(
      table.transactionNumber
    ),
  ]
);

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
    uniqueIndex("registration_submission_unique").on(
      table.submissionId
    ),
  ]
);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),

  submissionId: uuid("submission_id").references(
    () => pcuSubmissions.id
  ),

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
});
