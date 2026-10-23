
import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/app/db";
import { pcuSubmissions } from "@/app/db/schema";

import { isAuthorizedWorker } from "@/app/lib/worker-auth";
import { classifyPCU } from "@/app/lib/pcu-classification";
import { syncSubmissionToSheets } from "@/app/lib/google-sheets";

// =====================================================
// CONFIGURATION
// =====================================================

const MAX_ATTEMPTS = 3;

// =====================================================
// WORKER PAYLOAD VALIDATION
// =====================================================

const extractionSchema = z.object({
  transactionNumber: z.string().nullable(),
  pin: z.string().nullable(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  birthDate: z.string().nullable(),
  errorCode: z.string().nullable(),
  assignedClinic: z.string().nullable(),
});

const payloadSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("COMPLETED"),
    submissionId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    extraction: extractionSchema,
  }),
  z.object({
    status: z.literal("FAILED"),
    submissionId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    errorCode: z.enum([
      "OLLAMA_UNAVAILABLE",
      "OLLAMA_TIMEOUT",
      "OLLAMA_INVALID_RESPONSE",
      "SCREENSHOT_DOWNLOAD_FAILED",
      "AI_PROCESSING_FAILED",
    ]),
  }),
]);

function normalize(value: string | null) {
  return value?.trim() || null;
}

function normalizeDate(value: string | null) {
  const date = normalize(value);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

function normalizeExtraction(
  raw: z.infer<typeof extractionSchema>
) {
  const pinCandidate = normalize(raw.pin)?.replace(
    /[\s-]/g,
    ""
  );

  const pin =
    pinCandidate && /^\d{12}$/.test(pinCandidate)
      ? pinCandidate
      : null;

  const transactionCandidate = normalize(
    raw.transactionNumber
  )
    ?.toUpperCase()
    .replace(/[\s-]/g, "");

  const transactionNumber =
    transactionCandidate &&
    /^[A-Z0-9]{8,32}$/.test(transactionCandidate)
      ? transactionCandidate
      : null;

  const bounded = (value: string | null, limit: number) => {
    const text = normalize(value);
    return text && text.length <= limit ? text : null;
  };

  return {
    transactionNumber,
    pin,
    firstName: bounded(raw.firstName, 100),
    middleName: bounded(raw.middleName, 100),
    lastName: bounded(raw.lastName, 100),
    birthDate: normalizeDate(raw.birthDate),
    errorCode: bounded(raw.errorCode, 100),
    assignedClinic: bounded(raw.assignedClinic, 500),
  };
}

// =====================================================
// POST /api/internal/worker/result
// =====================================================

export async function POST(request: Request) {
  console.info("PCU_WORKER_RESULT_REQUEST_RECEIVED");

  if (!isAuthorizedWorker(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid worker result." },
      { status: 400 }
    );
  }

  const payload = parsed.data;

  const conditions = and(
    eq(pcuSubmissions.id, payload.submissionId),
    eq(pcuSubmissions.aiStatus, "PROCESSING"),
    eq(pcuSubmissions.aiLeaseToken, payload.leaseToken),
    gt(pcuSubmissions.aiLeaseExpiresAt, new Date()),
    eq(pcuSubmissions.submittedOutcome, "SUCCESS"),
    eq(pcuSubmissions.verificationStatus, "PENDING")
  );

  try {
    // =================================================
    // FAILED EXTRACTION
    // =================================================

    if (payload.status === "FAILED") {
      // The UPDATE is conditional on the lease.
      const [updated] = await db
        .update(pcuSubmissions)
        .set({
          aiStatus: "PENDING",
          aiLeaseToken: null,
          aiLeaseExpiresAt: null,
          aiLastError: payload.errorCode,
          updatedAt: new Date(),
        })
        .where(conditions)
        .returning({
          id: pcuSubmissions.id,
          attempts: pcuSubmissions.aiAttempts,
        });

      if (!updated) {
        return NextResponse.json(
          { error: "Job lease invalid or expired." },
          { status: 409 }
        );
      }

      if (updated.attempts >= MAX_ATTEMPTS) {
        await db
          .update(pcuSubmissions)
          .set({
            aiStatus: "FAILED",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pcuSubmissions.id, updated.id),
              eq(pcuSubmissions.aiStatus, "PENDING")
            )
          );
      }

      return NextResponse.json({
        success: true,
        retryAllowed: updated.attempts < MAX_ATTEMPTS,
      });
    }

    // =================================================
    // SUCCESSFUL EXTRACTION
    // =================================================

    const extracted = normalizeExtraction(
      payload.extraction
    );

    const classification = classifyPCU(
      "SUCCESS",
      extracted
    );

    // Accept results only from the active lease.
    // RHU-reviewed records cannot be overwritten.

    const [saved] = await db
      .update(pcuSubmissions)
      .set({
        transactionNumber: extracted.transactionNumber,
        extractedPin: extracted.pin,
        firstName: extracted.firstName,
        middleName: extracted.middleName,
        lastName: extracted.lastName,
        birthDate: extracted.birthDate,
        assignedClinic: extracted.assignedClinic,
        errorCode: extracted.errorCode,

        classification,

        aiStatus: "COMPLETED",
        aiProcessedAt: new Date(),
        aiLeaseToken: null,
        aiLeaseExpiresAt: null,
        aiLastError: null,

        sheetSyncStatus: "PENDING",
        updatedAt: new Date(),
      })
      .where(conditions)
      .returning();

    if (!saved) {
      return NextResponse.json(
        {
          error:
            "Job lease invalid, expired, or already reviewed.",
        },
        { status: 409 }
      );
    }

    console.info("PCU_WORKER_EXTRACTION_SAVED", {
      reference: saved.id,
      classification: saved.classification,
    });

    // =================================================
    // GOOGLE SHEETS SYNCHRONIZATION
    // =================================================

    let sheetsWritten = false;
    let targetSheet: string | null = null;

    try {
      const fullName = [
        saved.firstName,
        saved.middleName,
        saved.lastName,
      ]
        .filter(Boolean)
        .join(" ");

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

      if (sheetsWritten) {
        await db
          .update(pcuSubmissions)
          .set({
            sheetSyncStatus: "SYNCED",
            updatedAt: new Date(),
          })
          .where(eq(pcuSubmissions.id, saved.id));
      }
    } catch (error) {
      console.error("PCU_WORKER_SHEETS_SYNC_FAILED", {
        errorType:
          error instanceof Error
            ? error.name
            : "UNKNOWN",
      });
    }

    // =================================================
    // RESPONSE
    // =================================================

    return NextResponse.json({
      success: true,
      reference: saved.id,
      aiStatus: "COMPLETED",
      classification,
      verificationStatus: saved.verificationStatus,
      sheetSyncStatus: sheetsWritten
        ? "SYNCED"
        : "PENDING",
      targetSheet: sheetsWritten ? targetSheet : null,
      requiresReview: true,
    });
  } catch (error: unknown) {
    const cause =
      error instanceof Error ? error.cause : undefined;

    const dbError = cause as
      | {
          code?: string;
          column?: string;
          constraint?: string;
        }
      | undefined;

    console.error("PCU_WORKER_RESULT_FAILED", {
      name:
        error instanceof Error
          ? error.name
          : "UNKNOWN",
      postgresCode: dbError?.code ?? null,
      column: dbError?.column ?? null,
      constraint: dbError?.constraint ?? null,
    });

    return NextResponse.json(
      {
        success: false,
        error: "Worker result processing failed.",
      },
      { status: 500 }
    );
  }
}
