
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import { db } from "@/app/db";
import { pcuSubmissions } from "@/app/db/schema";

export const runtime = "nodejs";

const payloadSchema = z.object({
  submissionId: z.string().uuid(),
  extraction: z.object({
    transactionNumber: z.string().nullable(),
    pin: z.string().nullable(),
    firstName: z.string().nullable(),
    middleName: z.string().nullable(),
    lastName: z.string().nullable(),
    birthDate: z.string().nullable(),
    errorCode: z.string().nullable(),
    assignedClinic: z.string().nullable(),
  }),
});

function authorized(request: Request): boolean {
  const secret = process.env.PCU_WORKER_SECRET;
  const supplied = request.headers.get("x-worker-secret");

  if (!secret || !supplied) return false;

  const hash = (value: string) =>
    createHash("sha256").update(value).digest();

  return timingSafeEqual(hash(secret), hash(supplied));
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );

  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid extraction" },
      { status: 400 }
    );
  }

  const { submissionId, extraction } = body.data;

  // Validation must be enforced by the backend,
  // not only trusted to the local AI process.
  const pin =
    extraction.pin &&
    /^\d{12}$/.test(extraction.pin)
      ? extraction.pin
      : null;

  const transactionNumber =
    extraction.transactionNumber &&
    /^[A-Z0-9]{8,32}$/.test(
      extraction.transactionNumber
    )
      ? extraction.transactionNumber
      : null;

  const birthDate =
    extraction.birthDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      extraction.birthDate
    )
      ? extraction.birthDate
      : null;

  // Never overwrite a completed RHU review.
  // FAILED submissions retain manually entered
  // patient identity data.
  const [updated] = await db
    .update(pcuSubmissions)
    .set({
      transactionNumber,
      extractedPin: pin,
      ...(birthDate ? { birthDate } : {}),
      ...(extraction.firstName
        ? { firstName: extraction.firstName }
        : {}),
      ...(extraction.middleName
        ? { middleName: extraction.middleName }
        : {}),
      ...(extraction.lastName
        ? { lastName: extraction.lastName }
        : {}),
      assignedClinic: extraction.assignedClinic,
      errorCode: extraction.errorCode,
      classification: "MANUAL_REVIEW",
      sheetSyncStatus: "PENDING",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pcuSubmissions.id, submissionId),
        eq(pcuSubmissions.verificationStatus, "PENDING"),
        eq(pcuSubmissions.submittedOutcome, "SUCCESS")
      )
    )
    .returning({ id: pcuSubmissions.id });

  if (!updated) {
    return NextResponse.json(
      { error: "Submission unavailable for update" },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    reference: updated.id,
    requiresReview: true,
  });
}
