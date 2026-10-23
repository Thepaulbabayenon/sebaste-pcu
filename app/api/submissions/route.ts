
import { NextResponse } from "next/server";
import { z } from "zod";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { db } from "@/app/db";
import { pcuSubmissions } from "@/app/db/schema";
import { BARANGAYS } from "@/app/lib/barangays";

import {
  extractPCUData,
  type ExtractedPCU,
} from "@/app/lib/ocr";

import {
  saveScreenshot,
  deleteScreenshot,
} from "@/app/lib/storage";

import {
  syncSubmissionToSheets,
} from "@/app/lib/google-sheets";

// =====================================================
// CONFIGURATION
// =====================================================

const MAX_SIZE = 5 * 1024 * 1024;

type Classification =
  typeof pcuSubmissions.$inferInsert["classification"];

// =====================================================
// FORM VALIDATION
// =====================================================

const submissionSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({
      outcome: z.literal("SUCCESS"),
      barangay: z.enum(BARANGAYS),
    }),

    z.object({
      outcome: z.literal("FAILED"),
      barangay: z.enum(BARANGAYS),

      firstName: z.string().trim().min(1).max(100),
      middleName: z.string().trim().max(100),
      lastName: z.string().trim().min(1).max(100),
      birthDate: z.iso.date(),
    }),
  ]
);

// =====================================================
// IMAGE VALIDATION
// =====================================================

async function validateImage(
  buffer: Buffer
): Promise<"image/png" | "image/jpeg"> {
  const image = sharp(buffer, {
    limitInputPixels: 20_000_000,
  });

  const metadata = await image.metadata();

  if (
    metadata.format !== "png" &&
    metadata.format !== "jpeg"
  ) {
    throw new Error("INVALID_IMAGE_FORMAT");
  }

  await image.stats();

  return metadata.format === "png"
    ? "image/png"
    : "image/jpeg";
}

// =====================================================
// EXTRACTION HELPERS
// =====================================================

function emptyExtraction(): ExtractedPCU {
  return {
    rawText: "",
    transactionNumber: null,
    pin: null,
    firstName: null,
    middleName: null,
    lastName: null,
    birthDate: null,
    errorCode: null,
    assignedClinic: null,
    warnings: [],
  };
}

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function validPin(value: string | null | undefined) {
  return /^\d{12}$/.test(
    normalize(value).replace(/[\s-]/g, "")
  );
}

function validDate(value: string | null | undefined) {
  const date = normalize(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function hasCompleteDetails(
  extracted: ExtractedPCU
) {
  return (
    validPin(extracted.pin) &&
    normalize(extracted.firstName).length > 0 &&
    normalize(extracted.lastName).length > 0 &&
    validDate(extracted.birthDate) &&
    normalize(extracted.transactionNumber).length > 0
  );
}

// =====================================================
// CLINIC VALIDATION
// =====================================================

function isNotAssigned(
  clinicValue: string | null | undefined
) {
  const clinic = normalize(clinicValue);

  // Blank clinic is NOT equivalent to Not Assigned.
  return /^(?:not\s*(?:yet\s*)?assigned|unassigned|no\s*(?:assigned\s*)?(?:clinic|facility))(?:[.!])?$/i
    .test(clinic);
}

function isSebasteClinic(
  clinicValue: string | null | undefined
) {
  const clinic = normalize(clinicValue);

  if (!clinic) {
    return false;
  }

  if (
    /\b(?:not assigned|unassigned|not registered)\b/i
      .test(clinic)
  ) {
    return false;
  }

  const sebaste = /\bsebaste\b/i.test(clinic);

  const facility =
    /\b(?:yakap|clinic|rhu|rural health unit|health center)\b/i
      .test(clinic);

  return sebaste && facility;
}

// =====================================================
// CLASSIFICATION
// =====================================================

function classifySubmission(
  outcome: "SUCCESS" | "FAILED",
  extracted: ExtractedPCU
): Classification {
  // Submitted failed transactions go to FAILED.
  if (outcome === "FAILED") {
    return "FAILED";
  }

  // Never classify incomplete successful screenshots
  // as confirmed facility assignments.
  if (!hasCompleteDetails(extracted)) {
    return "MANUAL_REVIEW";
  }

  const clinic = normalize(extracted.assignedClinic);

  if (isNotAssigned(clinic)) {
    return "SUCCESS_NOT_ASSIGNED";
  }

  if (isSebasteClinic(clinic)) {
    return "SUCCESS_SEBASTE";
  }

  if (!clinic) {
    return "SUCCESS_NO_CLINIC";
  }

  // An identified facility that isn't Sebaste
  // must not appear in PCU_SUCCESS.
  return "SUCCESS_OTHER_CLINIC";
}

// =====================================================
// POST /api/submissions
// =====================================================

export async function POST(request: Request) {
  let screenshotKey: string | null = null;
  let persisted = false;
  let currentStep = "INITIALIZING";

  try {
    // -------------------------------------------------
    // 1. VALIDATE FORM
    // -------------------------------------------------

    currentStep = "VALIDATING_FORM";

    const form = await request.formData();

    const parsed = submissionSchema.safeParse({
      outcome: form.get("outcome"),
      barangay: form.get("barangay"),
      firstName: form.get("firstName"),
      middleName: form.get("middleName") ?? "",
      lastName: form.get("lastName"),
      birthDate: form.get("birthDate"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid submission information.",
        },
        { status: 400 }
      );
    }

    // -------------------------------------------------
    // 2. VALIDATE SCREENSHOT
    // -------------------------------------------------

    currentStep = "VALIDATING_SCREENSHOT";

    const file = form.get("screenshot");

    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > MAX_SIZE
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "A screenshot under 5 MB is required.",
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(
      await file.arrayBuffer()
    );

    let contentType: "image/png" | "image/jpeg";

    try {
      contentType = await validateImage(buffer);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Please upload a valid PNG or JPEG screenshot.",
        },
        { status: 400 }
      );
    }

    // -------------------------------------------------
    // 3. AI EXTRACTION
    // -------------------------------------------------

    currentStep = "AI_EXTRACTION";

    let extracted = emptyExtraction();

    try {
      extracted = await extractPCUData(buffer);
    } catch (error: unknown) {
      const err = error as {
        message?: string;
        code?: string | number;
        status?: number;
      };

      const knownErrors = new Set([
        "GEMINI_API_KEY_NOT_CONFIGURED",
        "EXTERNAL_AI_PROCESSING_NOT_APPROVED",
        "UNKNOWN_PCU_AI_PROVIDER",
        "LOCAL_VLM_NOT_CONFIGURED",
        "GEMINI_EMPTY_RESPONSE",
        "GEMINI_INVALID_JSON",
        "GEMINI_INVALID_SCHEMA",
      ]);

      const errorCode =
        err.message && knownErrors.has(err.message)
          ? err.message
          : "AI_PROVIDER_REQUEST_FAILED";

      console.error("PCU AI ERROR:", {
        errorCode,
        status: err.status ?? null,
        code: err.code ?? null,
      });

      return NextResponse.json(
        {
          success: false,
          error:
            "AI extraction is currently unavailable.",
          ...(process.env.NODE_ENV === "development"
            ? { errorCode }
            : {}),
        },
        { status: 503 }
      );
    }

    // -------------------------------------------------
    // 4. CLASSIFY EXTRACTION
    // -------------------------------------------------

    currentStep = "CLASSIFICATION";

    const classification = classifySubmission(
      parsed.data.outcome,
      extracted
    );

    // IMPORTANT:
    // Classification is provisional.
    // Registration verification remains PENDING.

    // -------------------------------------------------
    // 5. PREPARE PATIENT DATA
    // -------------------------------------------------

    currentStep = "PREPARING_PATIENT_DATA";

   
const failed = parsed.data.outcome === "FAILED";

let patientFields: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthDate: string | null;
};

if (parsed.data.outcome === "FAILED") {
  // TypeScript now knows this is the FAILED
  // branch of the discriminated union.
  patientFields = {
    firstName: parsed.data.firstName,
    middleName: parsed.data.middleName || null,
    lastName: parsed.data.lastName,
    birthDate: parsed.data.birthDate,
  };
} else {
  // Successful transactions use AI extraction.
  patientFields = {
    firstName: extracted.firstName,
    middleName: extracted.middleName,
    lastName: extracted.lastName,
    birthDate: extracted.birthDate,
  };
}


    // -------------------------------------------------
    // 6. SAVE SCREENSHOT
    // -------------------------------------------------

    currentStep = "STORAGE_UPLOAD";

    screenshotKey = await saveScreenshot(
      buffer,
      contentType
    );

    // -------------------------------------------------
    // 7. SAVE RECORD TO NEON
    // -------------------------------------------------

    currentStep = "DATABASE_INSERT";

    const [saved] = await db
      .insert(pcuSubmissions)
      .values({
        barangay: parsed.data.barangay,

        submittedOutcome: parsed.data.outcome,

        ...patientFields,

        transactionNumber: extracted.transactionNumber,

        // Failed transactions have no valid PIN
        // or clinic assignment.
        extractedPin: failed
          ? null
          : extracted.pin,

        assignedClinic: failed
          ? null
          : extracted.assignedClinic,

        errorCode: extracted.errorCode,

        screenshotKey,

        ocrRawText: extracted.rawText,

        classification,

        // AI classification is never RHU approval.
        verificationStatus: "PENDING",

        sheetSyncStatus: "PENDING",
      })
      .returning();

    if (!saved) {
      throw new Error(
        "DATABASE_INSERT_RETURNED_NO_RECORD"
      );
    }

    persisted = true;

    // -------------------------------------------------
    // 8. BUILD GOOGLE SHEETS DATA
    // -------------------------------------------------

    currentStep = "PREPARING_SHEET_DATA";

    const fullName = [
      saved.firstName,
      saved.middleName,
      saved.lastName,
    ]
      .filter(Boolean)
      .join(" ");

    // -------------------------------------------------
    // 9. IMMEDIATE GOOGLE SHEETS SYNC
    // -------------------------------------------------

    currentStep = "GOOGLE_SHEETS_SYNC";

    let sheetsWritten = false;
    let syncStatusRecorded = false;

    let targetSheet: string | null = null;

    try {
      const result = await syncSubmissionToSheets({
        id: saved.id,
        submittedAt: saved.submittedAt,
        barangay: saved.barangay,
        outcome: saved.submittedOutcome,
        classification: saved.classification,
        transactionNumber: saved.transactionNumber,
        fullName,
        birthDate: saved.birthDate,
        pin: saved.extractedPin,
        assignedClinic: saved.assignedClinic,
        errorCode: saved.errorCode,
        verificationStatus: saved.verificationStatus,
      });

      sheetsWritten = result.success;

      targetSheet = result.targetSheet;

      console.info("PCU_SYNC_RESULT", {
        targetSheet,
        success: sheetsWritten,
      });
    } catch (error: unknown) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(error.code)
          : "UNKNOWN";

      console.error(
        "PCU Google Sheets synchronization failed",
        { code }
      );
    }

    // -------------------------------------------------
    // 10. UPDATE DATABASE SYNC STATUS
    // -------------------------------------------------

    if (sheetsWritten) {
      currentStep = "UPDATING_SYNC_STATUS";

      try {
        await db
          .update(pcuSubmissions)
          .set({
            sheetSyncStatus: "SYNCED",
            updatedAt: new Date(),
          })
          .where(
            eq(pcuSubmissions.id, saved.id)
          );

        syncStatusRecorded = true;
      } catch {
        console.error(
          "Sheets succeeded but database sync " +
          "status update failed"
        );
      }
    }

    // -------------------------------------------------
    // 11. RETURN RESPONSE
    // -------------------------------------------------

    return NextResponse.json(
      {
        success: true,

        message:
          "PCU transaction saved successfully. " +
          "RHU verification is required.",

        reference: saved.id,

        classification: saved.classification,

        verificationStatus: saved.verificationStatus,

        targetSheet:
          sheetsWritten
            ? targetSheet
            : null,

        sheetSyncStatus:
          syncStatusRecorded
            ? "SYNCED"
            : "PENDING",

        requiresReview: true,

        ocrStatus: "EXTRACTED",

        ocrWarnings: extracted.warnings,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    // -------------------------------------------------
    // SAFE ERROR HANDLING
    // -------------------------------------------------

    const cause =
      error instanceof Error
        ? error.cause
        : undefined;

    const dbError = cause as
      | {
          code?: string;
          column?: string;
          constraint?: string;
        }
      | undefined;

    console.error("PCU submission failed:", {
      step: currentStep,
      code: dbError?.code ?? "UNKNOWN",
      column: dbError?.column,
      constraint: dbError?.constraint,
    });

    // Remove orphaned screenshots only if
    // the Neon record was not saved.
    if (!persisted && screenshotKey) {
      await deleteScreenshot(
        screenshotKey
      ).catch(() => {
        console.error(
          "Screenshot cleanup failed"
        );
      });
    }

    return NextResponse.json(
      {
        success: false,

        error:
          "PCU submission could not be completed.",

        step:
          process.env.NODE_ENV === "development"
            ? currentStep
            : undefined,
      },
      { status: 500 }
    );
  }
}
