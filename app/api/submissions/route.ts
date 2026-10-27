import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { eq } from "drizzle-orm";

import { db } from "@/app/db";
import { pcuSubmissions } from "@/app/db/schema";
import { BARANGAYS } from "@/app/lib/barangays";

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


// =====================================================
// FORM VALIDATION
// =====================================================

const submitterSchema = z
  .string()
  .trim()
  .min(2)
  .max(150);

const submissionSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({
      outcome: z.literal("SUCCESS"),
      barangay: z.enum(BARANGAYS),
      submittedBy: submitterSchema,
    }),

    z.object({
      outcome: z.literal("FAILED"),
      barangay: z.enum(BARANGAYS),
      submittedBy: submitterSchema,

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
// POST /api/submissions
// =====================================================

export async function POST(request: Request) {
  let screenshotKey: string | null = null;
  let persisted = false;
  let currentStep = "INITIALIZING";
  let savedReference: string | null = null;

  try {
    // -------------------------------------------------
    // 1. VALIDATE FORM
    // -------------------------------------------------

    currentStep = "VALIDATING_FORM";

    const form = await request.formData();

    const parsed = submissionSchema.safeParse({
      outcome: form.get("outcome"),
      barangay: form.get("barangay"),

      // New: BHW or encoder identity
      submittedBy: form.get("submittedBy"),

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
    // 3. PREPARE SUBMISSION
    // -------------------------------------------------

    currentStep = "PREPARING_SUBMISSION";

    const failed = parsed.data.outcome === "FAILED";

    let patientFields: {
      firstName: string | null;
      middleName: string | null;
      lastName: string | null;
      birthDate: string | null;
    };

    if (parsed.data.outcome === "FAILED") {
      patientFields = {
        firstName: parsed.data.firstName,
        middleName: parsed.data.middleName || null,
        lastName: parsed.data.lastName,
        birthDate: parsed.data.birthDate,
      };
    } else {
      // SUCCESS details are extracted later
      // by the local MacBook AI worker.
      patientFields = {
        firstName: null,
        middleName: null,
        lastName: null,
        birthDate: null,
      };
    }

    const aiStatus = failed
      ? ("SKIPPED" as const)
      : ("PENDING" as const);

    const classification = failed
      ? ("FAILED" as const)
      : ("MANUAL_REVIEW" as const);

    // -------------------------------------------------
    // 4. SAVE SCREENSHOT
    // -------------------------------------------------

    currentStep = "STORAGE_UPLOAD";

    screenshotKey = await saveScreenshot(
      buffer,
      contentType
    );

    // -------------------------------------------------
    // 5. SAVE TO NEON
    // -------------------------------------------------

    currentStep = "DATABASE_INSERT";

    const [saved] = await db
      .insert(pcuSubmissions)
      .values({
        barangay: parsed.data.barangay,

        submittedBy: parsed.data.submittedBy,

        submittedOutcome: parsed.data.outcome,

        ...patientFields,

        transactionNumber: null,
        extractedPin: null,
        verifiedPin: null,
        assignedClinic: null,
        errorCode: null,
        ocrRawText: null,

        screenshotKey,

        classification,
        verificationStatus: "PENDING",
        sheetSyncStatus: "PENDING",

        // PRIVATE AI WORKER QUEUE

        aiStatus,
        aiAttempts: 0,
        aiLeaseToken: null,
        aiLeaseExpiresAt: null,
        aiProcessedAt: null,
        aiLastError: null,
      })
      .returning();

    if (!saved) {
      throw new Error(
        "DATABASE_INSERT_RETURNED_NO_RECORD"
      );
    }

    persisted = true;
    savedReference = saved.id;

    console.info("PCU_SUBMISSION_SAVED", {
      reference: saved.id,
      outcome: saved.submittedOutcome,
      aiStatus,
      hasSubmitter: Boolean(saved.submittedBy),
    });

    // -------------------------------------------------
    // 6. GOOGLE SHEETS SYNCHRONIZATION
    // -------------------------------------------------

    // SUCCESS:
    // Wait for asynchronous AI extraction.
    //
    // FAILED:
    // Sync using manually entered patient details.

    let sheetsWritten = false;
    let syncStatusRecorded = false;
    let targetSheet: string | null = null;

    if (failed) {
      currentStep = "GOOGLE_SHEETS_SYNC";

      const fullName = [
        saved.firstName,
        saved.middleName,
        saved.lastName,
      ]
        .filter(Boolean)
        .join(" ");

      try {
        const result = await syncSubmissionToSheets({
          id: saved.id,
          submittedAt: saved.submittedAt,
          barangay: saved.barangay,
          submittedBy: saved.submittedBy,
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
          reference: saved.id,
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
          "PCU_GOOGLE_SHEETS_SYNC_FAILED",
          { code }
        );
      }

      // -------------------------------------------------
      // 7. UPDATE SHEETS SYNC STATUS
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
            "SHEETS_SYNC_STATUS_UPDATE_FAILED",
            { reference: saved.id }
          );
        }
      }
    }

    // -------------------------------------------------
    // 8. RETURN RESPONSE
    // -------------------------------------------------

    return NextResponse.json(
      {
        success: true,

        message: failed
          ? "PCU failed transaction saved successfully. " +
            "RHU verification is required."
          : "PCU screenshot received successfully. " +
            "AI extraction is queued for processing.",

        reference: saved.id,
        submittedBy: saved.submittedBy,

        classification: saved.classification,

        verificationStatus: saved.verificationStatus,

        targetSheet: sheetsWritten
          ? targetSheet
          : null,

        sheetSyncStatus: syncStatusRecorded
          ? "SYNCED"
          : "PENDING",

        requiresReview: true,

        aiStatus,

        ocrStatus: failed
          ? "SKIPPED"
          : "PENDING",

        ocrWarnings: [],

        extractionPending: !failed,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    // -------------------------------------------------
    // 9. ERROR HANDLING
    // -------------------------------------------------

    const traceId = randomUUID();

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

    console.error("PCU_SUBMISSION_FAILED", {
      traceId,
      reference: savedReference,
      step: currentStep,

      errorType:
        error instanceof Error
          ? error.name
          : "UNKNOWN",

      databaseCode: dbError?.code ?? null,
      column: dbError?.column ?? null,
      constraint: dbError?.constraint ?? null,
    });

    if (!persisted && screenshotKey) {
      await deleteScreenshot(screenshotKey).catch(() => {
        console.error("SCREENSHOT_CLEANUP_FAILED", {
          traceId,
        });
      });
    }

    return NextResponse.json(
      {
        success: false,

        error:
          "PCU submission could not be completed.",

        reference: traceId,

        step:
          process.env.NODE_ENV === "development"
            ? currentStep
            : undefined,
      },
      { status: 500 }
    );
  }
}