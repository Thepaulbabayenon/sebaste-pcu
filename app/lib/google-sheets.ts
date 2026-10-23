
import "server-only";

import { google } from "googleapis";
import path from "node:path";

import type {
  PCUClassification,
  PCUOutcome,
} from "./classification";

// =====================================================
// TYPES
// =====================================================

export type SheetSubmission = {
  id: string;
  submittedAt: Date;
  barangay: string;
  outcome: PCUOutcome;
  classification: PCUClassification;
  transactionNumber: string | null;
  fullName: string;
  birthDate: string | null;
  pin: string | null;
  assignedClinic: string | null;
  errorCode: string | null;
  verificationStatus: string;
};

type PCUSheetName =
  | "PCU_ALL_SUBMISSIONS"
  | "PCU_SUCCESS"
  | "PCU_NOT_ASSIGNED"
  | "PCU_FAILED";

type CategorySheet =
  | "PCU_SUCCESS"
  | "PCU_NOT_ASSIGNED"
  | "PCU_FAILED";

// =====================================================
// CONFIGURATION
// =====================================================

const PCU_SHEETS: readonly PCUSheetName[] = [
  "PCU_ALL_SUBMISSIONS",
  "PCU_SUCCESS",
  "PCU_NOT_ASSIGNED",
  "PCU_FAILED",
];

const HEADERS = [
  "Submission ID",
  "Submitted At",
  "Barangay",
  "Outcome",
  "Classification",
  "Transaction Number",
  "Full Name",
  "Birthdate",
  "PIN",
  "Assigned Clinic",
  "Error Code",
  "Verification Status",
];

const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";

// =====================================================
// GOOGLE AUTHENTICATION
// =====================================================

function getSpreadsheetId(): string {
  const id = process.env.PKRF_SPREADSHEET_ID?.trim();

  if (!id) {
    throw new Error(
      "PKRF_SPREADSHEET_ID is missing"
    );
  }

  return id;
}

function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(
      process.cwd(),
      "credentials",
      "google-service-account.json"
    ),
    scopes: [GOOGLE_SHEETS_SCOPE],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

// =====================================================
// HELPERS
// =====================================================

function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function normalizeText(
  value: string | null | undefined
): string {
  return String(value ?? "").trim();
}

function safeCell(
  value: string | null | undefined
): string {
  const text = normalizeText(value);

  // Prevent spreadsheet formula injection.
  if (/^\s*[=+\-@]/.test(text)) {
    return "'" + text;
  }

  return text;
}

function normalizePin(
  value: string | null | undefined
): string {
  return normalizeText(value).replace(
    /[\s-]/g,
    ""
  );
}

function validPin(
  value: string | null | undefined
): boolean {
  return /^\d{12}$/.test(normalizePin(value));
}

function validBirthDate(
  value: string | null | undefined
): boolean {
  const date = normalizeText(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function validPatientName(name: string): boolean {
  const parts = normalizeText(name)
    .split(/\s+/)
    .filter(Boolean);

  // Basic completeness check.
  // Names are not independently identity-verified.
  return (
    parts.length >= 2 &&
    parts.every((part) => part.length > 0)
  );
}

function completePatientDetails(
  data: SheetSubmission
): boolean {
  return (
    validPin(data.pin) &&
    validPatientName(data.fullName) &&
    validBirthDate(data.birthDate) &&
    normalizeText(data.transactionNumber).length > 0
  );
}

// =====================================================
// CLINIC CLASSIFICATION
// =====================================================

function isNotAssignedClinic(
  value: string | null | undefined
): boolean {
  const clinic = normalizeText(value);

  // Must explicitly indicate no assignment.
  // A completely empty field does not qualify.
  return /^(?:not\s*(?:yet\s*)?assigned|unassigned|no\s*(?:assigned\s*)?(?:facility|clinic))(?:[.!])?$/i
    .test(clinic);
}

function isSebasteClinic(
  value: string | null | undefined
): boolean {
  const clinic = normalizeText(value);

  if (!clinic) {
    return false;
  }

  // Do not accept negated clinic assignments.
  if (
    /\b(?:not assigned|unassigned|not registered)\b/i
      .test(clinic)
  ) {
    return false;
  }

  // Require explicit Sebaste + relevant
  // facility terminology.
  const hasSebaste = /\bsebaste\b/i.test(clinic);

  const hasClinic =
    /\b(?:yakap|clinic|rhu|rural health unit|health center)\b/i
      .test(clinic);

  return hasSebaste && hasClinic;
}

// =====================================================
// DESTINATION VALIDATION
// =====================================================

/**
 * Determine destination using:
 *
 * 1. User-submitted outcome
 * 2. Stored classification
 * 3. Extracted patient details
 * 4. Explicit clinic assignment
 *
 * Do not infer "Not Assigned" from a blank clinic.
 *
 * Do not route other clinics into PCU_SUCCESS.
 */
export function getTargetSheet(
  data: SheetSubmission
): CategorySheet | null {
  const outcome = data.outcome;
  const classification = data.classification;

  // ----------------------------------------------
  // FAILED
  // ----------------------------------------------

  if (outcome === "FAILED") {
    return "PCU_FAILED";
  }

  if (outcome !== "SUCCESS") {
    return null;
  }

  // Contradictory AI classification requires review.
  if (classification === "FAILED") {
    return null;
  }

  // ----------------------------------------------
  // VALIDATE SUCCESS DETAILS
  // ----------------------------------------------

  if (!completePatientDetails(data)) {
    return null;
  }

  // Explicit classifications for other clinics
  // or unknown clinics must not be overwritten.
  if (
    classification === "SUCCESS_OTHER_CLINIC" ||
    classification === "SUCCESS_NO_CLINIC"
  ) {
    return null;
  }

  const sebaste = isSebasteClinic(
    data.assignedClinic
  );

  const notAssigned = isNotAssignedClinic(
    data.assignedClinic
  );

  // ----------------------------------------------
  // NOT ASSIGNED
  // ----------------------------------------------

  if (notAssigned) {
    if (classification === "SUCCESS_SEBASTE") {
      return null;
    }

    return "PCU_NOT_ASSIGNED";
  }

  // ----------------------------------------------
  // SEBASTE SUCCESS
  // ----------------------------------------------

  if (sebaste) {
    if (
      classification === "SUCCESS_NOT_ASSIGNED"
    ) {
      return null;
    }

    return "PCU_SUCCESS";
  }

  // Other clinics, blank clinics and uncertain
  // records remain in ALL_SUBMISSIONS only.
  return null;
}

// =====================================================
// RESOLVED CLASSIFICATION
// =====================================================

function getResolvedClassification(
  data: SheetSubmission,
  target: CategorySheet | null
): PCUClassification {
  switch (target) {
    case "PCU_SUCCESS":
      return "SUCCESS_SEBASTE";

    case "PCU_NOT_ASSIGNED":
      return "SUCCESS_NOT_ASSIGNED";

    case "PCU_FAILED":
      return "FAILED";

    default:
      return data.classification;
  }
}

// =====================================================
// ROW CONSTRUCTION
// =====================================================

function buildRow(
  data: SheetSubmission,
  target: CategorySheet | null = null
): string[] {
  const failed =
    data.outcome === "FAILED" ||
    target === "PCU_FAILED";

  const resolvedClassification =
    getResolvedClassification(data, target);

  return [
    data.id,
    data.submittedAt.toISOString(),
    data.barangay,
    data.outcome,
    resolvedClassification,
    data.transactionNumber ?? "",
    data.fullName,
    data.birthDate ?? "",

    // Failed submissions must not have a PIN
    // or assigned clinic in Google Sheets.
    failed ? "" : normalizePin(data.pin),

    failed ? "" : data.assignedClinic ?? "",

    data.errorCode ?? "",
    data.verificationStatus,
  ].map(safeCell);
}

// =====================================================
// WORKSHEET INITIALIZATION
// =====================================================

/**
 * Creates only missing PCU worksheets.
 *
 * Existing PKRF worksheets remain untouched.
 * Existing PCU headers must match this app's
 * expected 12-column layout.
 */
export async function ensurePCUSheets() {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheets();

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title)",
  });

  const existing = new Set(
    metadata.data.sheets?.map(
      (sheet) => sheet.properties?.title
    ) ?? []
  );

  const missing = PCU_SHEETS.filter(
    (name) => !existing.has(name)
  );

  if (missing.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((name) => ({
          addSheet: {
            properties: {
              title: name,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        })),
      },
    });
  }

  for (const name of PCU_SHEETS) {
    const range =
      `${quoteSheetName(name)}!A1:L1`;

    const response =
      await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

    const currentHeaders =
      response.data.values?.[0] ?? [];

    if (currentHeaders.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: {
          values: [HEADERS],
        },
      });

      continue;
    }

    const correct = HEADERS.every(
      (header, index) =>
        currentHeaders[index] === header
    );

    if (!correct) {
      throw new Error(
        `Header mismatch in ${name}. ` +
        "Existing headers were preserved. " +
        "Do not overwrite this sheet automatically."
      );
    }
  }
}

// =====================================================
// UUID-BASED UPSERT
// =====================================================

/**
 * Updates an existing UUID or inserts a new row.
 *
 * RAW input preserves PIN leading zeros because
 * PINs are always passed as strings.
 */
async function upsertRow(
  sheetName: PCUSheetName,
  data: SheetSubmission,
  target: CategorySheet | null = null
) {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheets();
  const quoted = quoteSheetName(sheetName);

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoted}!A2:A`,
    });

  const existingRows = response.data.values ?? [];

  const index = existingRows.findIndex(
    (row) => row[0] === data.id
  );

  const values = [buildRow(data, target)];

  if (index >= 0) {
    const actualRow = index + 2;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:
        `${quoted}!A${actualRow}:L${actualRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });

    return {
      action: "updated" as const,
      sheet: sheetName,
    };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoted}!A:L`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return {
    action: "inserted" as const,
    sheet: sheetName,
  };
}

// =====================================================
// MAIN SYNCHRONIZATION
// =====================================================

/**
 * Call immediately after a submission has
 * been successfully saved to Neon.
 *
 * Every submission goes to ALL_SUBMISSIONS.
 *
 * Eligible submissions also go into precisely
 * one operational category sheet.
 */
export async function syncSubmissionToSheets(
  data: SheetSubmission
) {
  if (!data.id) {
    throw new Error("Submission ID is required");
  }

  if (
    !(data.submittedAt instanceof Date) ||
    Number.isNaN(data.submittedAt.getTime())
  ) {
    throw new Error(
      "Valid submittedAt is required"
    );
  }

  // Determine the destination before writing.
  const target = getTargetSheet(data);

  // Create/validate the four worksheets.
  await ensurePCUSheets();

  // 1. Always synchronize ALL submissions.
  const allResult = await upsertRow(
    "PCU_ALL_SUBMISSIONS",
    data,
    target
  );

  // 2. Synchronize the matching category.
  let categoryResult = null;

  if (target) {
    categoryResult = await upsertRow(
      target,
      data,
      target
    );
  }

  // Avoid logging patient names, PINs,
  // transaction numbers or screenshot text.
  console.info("PCU_SHEETS_SYNC_COMPLETED", {
    submissionId: data.id,
    classification: getResolvedClassification(
      data,
      target
    ),
    targetSheet: target ?? "MANUAL_REVIEW",
    allAction: allResult.action,
    categoryAction:
      categoryResult?.action ?? null,
  });

  return {
    success: true,
    reference: data.id,
    targetSheet: target ?? "MANUAL_REVIEW",
    classification: getResolvedClassification(
      data,
      target
    ),
    allAction: allResult.action,
    categoryAction:
      categoryResult?.action ?? null,
  };
}
