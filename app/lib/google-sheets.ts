
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

  // BHW / encoder who submitted the screenshot.
  // Optional for compatibility with older sync callers
  // and historical submissions.
  submittedBy?: string | null;

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

// Existing 12 columns.
// These must retain their original positions.
const LEGACY_HEADERS = [
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

// Add the new field at column M.
// Never shift existing columns automatically.
const HEADERS = [
  ...LEGACY_HEADERS,
  "Submitted By",
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
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();

  const rawKey =
    process.env.GOOGLE_PRIVATE_KEY;

  const hasEmail = Boolean(email);
  const hasKey = Boolean(rawKey?.trim());

  if (hasEmail !== hasKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_CONFIGURATION_INCOMPLETE"
    );
  }

  let auth: InstanceType<
    typeof google.auth.GoogleAuth
  >;

  if (email && rawKey) {
    // Supports keys with literal \n characters
    // as well as actual multiline private keys.
    const privateKey = rawKey
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "\n");

    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: email,
        private_key: privateKey,
      },
      scopes: [GOOGLE_SHEETS_SCOPE],
    });
  } else {
    // Local development fallback.
    // Vercel should use environment credentials.
    auth = new google.auth.GoogleAuth({
      keyFile: path.join(
        process.cwd(),
        "credentials",
        "google-service-account.json"
      ),
      scopes: [GOOGLE_SHEETS_SCOPE],
    });
  }

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

  // Prevent formula injection when writing to Sheets.
  if (/^[=+\-@]/.test(text)) {
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

  const parsed = new Date(
    `${date}T00:00:00Z`
  );

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function validPatientName(name: string): boolean {
  const parts = normalizeText(name)
    .split(/\s+/)
    .filter(Boolean);

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

  return /^(?:not\s*(?:yet\s*)?assigned|unassigned|no\s*(?:assigned\s*)?(?:facility|clinic))(?:[.!])?$/i.test(
    clinic
  );
}

function isSebasteClinic(
  value: string | null | undefined
): boolean {
  const clinic = normalizeText(value);

  if (!clinic) {
    return false;
  }

  if (
    /\b(?:not assigned|unassigned|not registered)\b/i.test(
      clinic
    )
  ) {
    return false;
  }

  const hasSebaste =
    /\bsebaste\b/i.test(clinic);

  const hasClinic =
    /\b(?:yakap|clinic|rhu|rural health unit|health center)\b/i.test(
      clinic
    );

  return hasSebaste && hasClinic;
}

// =====================================================
// DESTINATION VALIDATION
// =====================================================

export function getTargetSheet(
  data: SheetSubmission
): CategorySheet | null {
  const outcome = data.outcome;
  const classification = data.classification;

  if (outcome === "FAILED") {
    return "PCU_FAILED";
  }

  if (outcome !== "SUCCESS") {
    return null;
  }

  if (classification === "FAILED") {
    return null;
  }

  // Successful records require complete AI extraction
  // before being added to a category worksheet.
  if (!completePatientDetails(data)) {
    return null;
  }

  // Other/unknown clinics remain in ALL_SUBMISSIONS.
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

  if (notAssigned) {
    if (classification === "SUCCESS_SEBASTE") {
      return null;
    }

    return "PCU_NOT_ASSIGNED";
  }

  if (sebaste) {
    if (
      classification === "SUCCESS_NOT_ASSIGNED"
    ) {
      return null;
    }

    return "PCU_SUCCESS";
  }

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
    // A - Submission ID
    data.id,

    // B - Submitted At
    data.submittedAt.toISOString(),

    // C - Barangay
    data.barangay,

    // D - Outcome
    data.outcome,

    // E - Classification
    resolvedClassification,

    // F - Transaction Number
    data.transactionNumber ?? "",

    // G - Patient Name
    data.fullName,

    // H - Birthdate
    data.birthDate ?? "",

    // I - PIN
    failed ? "" : normalizePin(data.pin),

    // J - Assigned Clinic
    failed ? "" : data.assignedClinic ?? "",

    // K - Error Code
    data.errorCode ?? "",

    // L - RHU Verification
    data.verificationStatus,

    // M - BHW / Encoder name
    data.submittedBy ?? "",
  ].map(safeCell);
}

// =====================================================
// WORKSHEET INITIALIZATION
// =====================================================

/**
 * Creates missing PCU worksheets.
 *
 * Preserves existing PKRF worksheets.
 *
 * Accepts existing 12-column PCU worksheets,
 * then safely adds Submitted By in column M.
 *
 * Never rewrites existing patient data.
 */
export async function ensurePCUSheets() {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getSheets();

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,gridProperties(columnCount))",
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
    const quoted = quoteSheetName(name);

    // Read A-M so the new column is visible.
    const response =
      await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${quoted}!A1:M1`,
      });

    const currentHeaders =
      response.data.values?.[0] ?? [];

    if (currentHeaders.length === 0) {
      // New worksheet: initialize all 13 columns.
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${quoted}!A1:M1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [HEADERS],
        },
      });

      continue;
    }

    // Existing A-L headers must be unchanged.
    const legacyCorrect =
      LEGACY_HEADERS.every(
        (header, index) =>
          currentHeaders[index] === header
      );

    if (!legacyCorrect) {
      throw new Error(
        `PCU_HEADER_MISMATCH:${name}`
      );
    }

    // Column M may already exist.
    const submittedByHeader =
      currentHeaders[12] ?? "";

    if (submittedByHeader === "Submitted By") {
      continue;
    }

    if (submittedByHeader !== "") {
      // Never overwrite an existing unrelated column.
      throw new Error(
        `PCU_SUBMITTER_COLUMN_CONFLICT:${name}`
      );
    }

    // Safe upgrade: only write the new header cell.
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoted}!M1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Submitted By"]],
      },
    });

    console.info("PCU_SHEET_HEADER_UPGRADED", {
      worksheet: name,
      addedColumn: "M",
    });
  }
}

// =====================================================
// UUID-BASED UPSERT
// =====================================================

/**
 * Updates a row with the same submission UUID or
 * appends a new row.
 *
 * RAW input prevents Sheets from interpreting
 * patient PINs as numerical data.
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

  const existingRows =
    response.data.values ?? [];

  const index = existingRows.findIndex(
    (row) => row[0] === data.id
  );

  const values = [buildRow(data, target)];

  if (index >= 0) {
    const actualRow = index + 2;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:
        `${quoted}!A${actualRow}:M${actualRow}`,
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
    range: `${quoted}!A:M`,
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
 * Every submission is written to ALL_SUBMISSIONS.
 *
 * An eligible submission may also be written to
 * one corresponding category worksheet.
 *
 * Existing UUIDs are updated rather than appended.
 */
export async function syncSubmissionToSheets(
  data: SheetSubmission
) {
  if (!data.id) {
    throw new Error(
      "Submission ID is required"
    );
  }

  if (
    !(data.submittedAt instanceof Date) ||
    Number.isNaN(data.submittedAt.getTime())
  ) {
    throw new Error(
      "Valid submittedAt is required"
    );
  }

  const target = getTargetSheet(data);

  // Ensure expected worksheets and headers exist.
  await ensurePCUSheets();

  // 1. All submissions.
  const allResult = await upsertRow(
    "PCU_ALL_SUBMISSIONS",
    data,
    target
  );

  // 2. Matching category.
  let categoryResult = null;

  if (target) {
    categoryResult = await upsertRow(
      target,
      data,
      target
    );
  }

  // Never log patient names, PINs,
  // birthdates or screenshot contents.
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
