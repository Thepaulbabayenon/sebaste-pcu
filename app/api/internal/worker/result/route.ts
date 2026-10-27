
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

// =====================================================
// HELPERS
// =====================================================

function normalize(
  value: string | null
): string | null {
  return value?.trim() || null;
}

function normalizeDate(
  value: string | null
): string | null {
  const date = normalize(value);

  if (
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return null;
  }

  const parsed = new Date(
    `${date}T00:00:00Z`
  );

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

function normalizeExtraction(
  raw: z.infer<typeof extractionSchema>
) {
  const pinCandidate = normalize(
    raw.pin
  )?.replace(/[\s-]/g, "");

  const pin =
    pinCandidate &&
    /^\d{12}$/.test(pinCandidate)
      ? pinCandidate
      : null;

  const transactionCandidate = normalize(
    raw.transactionNumber
  )
    ?.toUpperCase()
    .replace(/[\s-]/g, "");

  const transactionNumber =
    transactionCandidate &&
    /^[A-Z0-9]{8,32}$/.test(
      transactionCandidate
    )
      ? transactionCandidate
      : null;

  const bounded = (
    value: string | null,
    limit: number
  ) => {
    const text = normalize(value);

    return text && text.length <= limit
      ? text
      : null;
  };

  return {
    transactionNumber,
    pin,

    firstName: bounded(
      raw.firstName,
      100
    ),

    middleName: bounded(
      raw.middleName,
      100
    ),

    lastName: bounded(
      raw.lastName,
      100
    ),

    birthDate: normalizeDate(
      raw.birthDate
    ),

    errorCode: bounded(
      raw.errorCode,
      100
    ),

    assignedClinic: bounded(
      raw.assignedClinic,
      500
    ),
  };
}

// =====================================================
// SAFE ERROR DIAGNOSTICS
// =====================================================

function getErrorDiagnostics(error: unknown) {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return {
      errorType: "UNKNOWN",
      code: null,
      httpStatus: null,
    };
  }

  const err = error as {
    name?: string;
    code?: string | number;
    status?: number;
    response?: {
      status?: number;
    };
  };

  return {
    errorType: err.name ?? "UNKNOWN",
    code: err.code ?? null,
    httpStatus:
      err.response?.status ??
      err.status ??
      null,
  };
}

// =====================================================
// POST /api/internal/worker/result
// =====================================================

export async function POST(request: Request) {
  console.info(
    "PCU_WORKER_RESULT_REQUEST_RECEIVED"
  );

  // ---------------------------------------------------
  // 1. AUTHENTICATE PRIVATE WORKER
  // ---------------------------------------------------

  if (!isAuthorizedWorker(request)) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      { status: 401 }
    );
  }

  // ---------------------------------------------------
  // 2. VALIDATE PAYLOAD
  // ---------------------------------------------------

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid worker result.",
      },
      { status: 400 }
    );
  }

  const payload = parsed.data;

  // ---------------------------------------------------
  // 3. VERIFY ACTIVE WORKER LEASE
  // ---------------------------------------------------

  const conditions = and(
    eq(
      pcuSubmissions.id,
      payload.submissionId
    ),

    eq(
      pcuSubmissions.aiStatus,
      "PROCESSING"
    ),

    eq(
      pcuSubmissions.aiLeaseToken,
      payload.leaseToken
    ),

    gt(
      pcuSubmissions.aiLeaseExpiresAt,
      new Date()
    ),

    eq(
      pcuSubmissions.submittedOutcome,
      "SUCCESS"
    ),

    eq(
      pcuSubmissions.verificationStatus,
      "PENDING"
    )
  );

  try {
    // =================================================
    // 4. FAILED EXTRACTION
    // =================================================

    if (payload.status === "FAILED") {
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
          {
            success: false,
            error:
              "Job lease invalid or expired.",
          },
          { status: 409 }
        );
      }

      // Retry only up to the configured limit.
      if (
        updated.attempts >= MAX_ATTEMPTS
      ) {
        await db
          .update(pcuSubmissions)
          .set({
            aiStatus: "FAILED",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                pcuSubmissions.id,
                updated.id
              ),

              eq(
                pcuSubmissions.aiStatus,
                "PENDING"
              )
            )
          );
      }

      console.info(
        "PCU_WORKER_EXTRACTION_FAILED",
        {
          reference: updated.id,
          errorCode: payload.errorCode,
          attempts: updated.attempts,
          retryAllowed:
            updated.attempts < MAX_ATTEMPTS,
        }
      );

      return NextResponse.json({
        success: true,
        reference: updated.id,
        retryAllowed:
          updated.attempts < MAX_ATTEMPTS,
      });
    }

    // =================================================
    // 5. SUCCESSFUL EXTRACTION
    // =================================================

    const extracted = normalizeExtraction(
      payload.extraction
    );

    const classification = classifyPCU(
      "SUCCESS",
      extracted
    );

    // Save AI results only if this worker still
    // owns the active lease.
    //
    // RHU-reviewed submissions cannot be
    // overwritten by delayed worker results.

    const [saved] = await db
      .update(pcuSubmissions)
      .set({
        transactionNumber:
          extracted.transactionNumber,

        extractedPin:
          extracted.pin,

        firstName:
          extracted.firstName,

        middleName:
          extracted.middleName,

        lastName:
          extracted.lastName,

        birthDate:
          extracted.birthDate,

        assignedClinic:
          extracted.assignedClinic,

        errorCode:
          extracted.errorCode,

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
          success: false,
          error:
            "Job lease invalid, expired, or already reviewed.",
        },
        { status: 409 }
      );
    }

    console.info(
      "PCU_WORKER_EXTRACTION_SAVED",
      {
        reference: saved.id,
        classification:
          saved.classification,
        hasSubmitter:
          Boolean(saved.submittedBy),
      }
    );

    // =================================================
    // 6. GOOGLE SHEETS SYNCHRONIZATION
    // =================================================

    let sheetsWritten = false;

    let syncStatusRecorded = false;

    let targetSheet: string | null = null;

    try {
      const fullName = [
        saved.firstName,
        saved.middleName,
        saved.lastName,
      ]
        .filter(Boolean)
        .join(" ");

      const result =
        await syncSubmissionToSheets({
          id: saved.id,

          submittedAt:
            saved.submittedAt,

          barangay:
            saved.barangay,

          // NEW:
          // BHW / Encoder who submitted
          // the screenshot.
          submittedBy:
            saved.submittedBy,

          outcome:
            saved.submittedOutcome,

          classification:
            saved.classification,

          transactionNumber:
            saved.transactionNumber,

          fullName,

          birthDate:
            saved.birthDate,

          pin:
            saved.extractedPin,

          assignedClinic:
            saved.assignedClinic,

          errorCode:
            saved.errorCode,

          verificationStatus:
            saved.verificationStatus,
        });

      sheetsWritten = result.success;

      targetSheet =
        result.targetSheet ?? null;

      console.info(
        "PCU_SHEETS_SYNC_DIAGNOSTIC",
        {
          submissionId: saved.id,

          success: result.success,

          targetSheet,

          hasSubmitter:
            Boolean(saved.submittedBy),
        }
      );

      // -----------------------------------------------
      // 7. UPDATE NEON SHEET SYNC STATUS
      // -----------------------------------------------

      if (sheetsWritten) {
        await db
          .update(pcuSubmissions)
          .set({
            sheetSyncStatus: "SYNCED",
            updatedAt: new Date(),
          })
          .where(
            eq(
              pcuSubmissions.id,
              saved.id
            )
          );

        syncStatusRecorded = true;
      }
    } catch (error: unknown) {
      // Google Sheets or sync-status update failure
      // must not undo a completed AI extraction.

      console.error(
        "PCU_WORKER_SHEETS_SYNC_FAILED",
        {
          submissionId: saved.id,
          ...getErrorDiagnostics(error),
        }
      );
    }

    // =================================================
    // 8. RETURN RESPONSE
    // =================================================

    return NextResponse.json({
      success: true,

      reference: saved.id,

      aiStatus: "COMPLETED",

      classification,

      verificationStatus:
        saved.verificationStatus,

      sheetSyncStatus:
        syncStatusRecorded
          ? "SYNCED"
          : "PENDING",

      targetSheet:
        syncStatusRecorded
          ? targetSheet
          : null,

      requiresReview: true,
    });
  } catch (error: unknown) {
    // =================================================
    // 9. FINAL ERROR HANDLER
    // =================================================

    // This catches unexpected worker-result
    // processing errors, including database errors.
    //
    // Never log raw extraction data or patient
    // information.

    console.error(
      "PCU_WORKER_RESULT_FAILED",
      {
        submissionId:
          payload.submissionId,

        ...getErrorDiagnostics(error),
      }
    );

    return NextResponse.json(
      {
        success: false,

        error:
          "Worker result processing failed.",
      },
      { status: 500 }
    );
  }
}
