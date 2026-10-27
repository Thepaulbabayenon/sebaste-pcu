"use client";

import Dexie, { type Table } from "dexie";

// =====================================================
// TYPES
// =====================================================

export type OfflineSubmissionStatus =
  | "SAVED_OFFLINE"
  | "UPLOADING"
  | "UPLOADED"
  | "NEEDS_ATTENTION";

export type OfflineSubmission = {
  id: string;

  barangay: string;

  // Optional for compatibility with existing local
  // records saved before this field was introduced.
  submittedBy?: string;

  outcome: "SUCCESS" | "FAILED";

  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthDate: string | null;

  screenshot: Blob;
  screenshotName: string;
  screenshotType: string;

  status: OfflineSubmissionStatus;

  createdAt: number;
  updatedAt: number;

  attempts: number;
  serverReference: string | null;
};

// =====================================================
// INDEXEDDB DATABASE
// =====================================================

class PCUOfflineDatabase extends Dexie {
  submissions!: Table<OfflineSubmission, string>;

  constructor() {
    super("sebaste-pcu-offline");

    // submittedBy is a normal stored property.
    // No new index or Dexie version is required.
    this.version(1).stores({
      submissions: "id, status, createdAt, barangay",
    });
  }
}

export const offlineDb = new PCUOfflineDatabase();

// =====================================================
// SAVE OFFLINE SUBMISSION
// =====================================================

export async function saveOfflineSubmission(input: {
  barangay: string;
  submittedBy: string;
  outcome: "SUCCESS" | "FAILED";
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  birthDate?: string | null;
  screenshot: File;
}): Promise<string> {
  const submittedBy = input.submittedBy.trim();

  if (
    submittedBy.length < 2 ||
    submittedBy.length > 150
  ) {
    throw new Error("INVALID_SUBMITTER_NAME");
  }

  if (
    input.screenshot.size === 0 ||
    input.screenshot.size > 5 * 1024 * 1024 ||
    !["image/png", "image/jpeg"].includes(
      input.screenshot.type
    )
  ) {
    throw new Error("INVALID_SCREENSHOT");
  }

  if (
    input.outcome === "FAILED" &&
    (!input.firstName?.trim() ||
      !input.lastName?.trim() ||
      !input.birthDate)
  ) {
    throw new Error("INVALID_PATIENT_INFORMATION");
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  await offlineDb.submissions.add({
    id,
    barangay: input.barangay,
    submittedBy,
    outcome: input.outcome,

    firstName:
      input.outcome === "FAILED"
        ? input.firstName?.trim() ?? null
        : null,

    middleName:
      input.outcome === "FAILED"
        ? input.middleName?.trim() ?? null
        : null,

    lastName:
      input.outcome === "FAILED"
        ? input.lastName?.trim() ?? null
        : null,

    birthDate:
      input.outcome === "FAILED"
        ? input.birthDate ?? null
        : null,

    screenshot: input.screenshot,
    screenshotName: input.screenshot.name,
    screenshotType: input.screenshot.type,

    status: "SAVED_OFFLINE",

    createdAt: now,
    updatedAt: now,

    attempts: 0,
    serverReference: null,
  });

  return id;
}

// =====================================================
// READ OFFLINE SUBMISSIONS
// =====================================================

export async function getOfflineSubmissions() {
  return offlineDb.submissions
    .orderBy("createdAt")
    .reverse()
    .toArray();
}

// =====================================================
// COUNT PENDING SUBMISSIONS
// =====================================================

export async function getPendingSubmissionCount() {
  return offlineDb.submissions
    .where("status")
    .anyOf("SAVED_OFFLINE", "NEEDS_ATTENTION")
    .count();
}