
import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { asc, gt } from "drizzle-orm";

import { db } from "@/app/db";
import { pcuSubmissions } from "@/app/db/schema";

// No runtime or dynamic exports.
// Compatible with cacheComponents: true.

function authorized(request: NextRequest): boolean {
  const secret = process.env.PCU_SHEETS_SYNC_SECRET;
  const supplied = request.headers.get("x-sync-secret");

  if (!secret || !supplied) {
    return false;
  }

  const hash = (value: string) =>
    createHash("sha256")
      .update(value)
      .digest();

  return timingSafeEqual(
    hash(secret),
    hash(supplied)
  );
}

export async function GET(request: NextRequest) {
  const headers = {
    "Cache-Control": "private, no-store",
  };

  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers }
    );
  }

  try {
    const cursor = request.nextUrl.searchParams.get("after");
    const limit = 200;

    // Validate UUID cursor.
    if (
      cursor &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor)
    ) {
      return NextResponse.json(
        { error: "Invalid cursor" },
        { status: 400, headers }
      );
    }

    const rows = await db
      .select({
        id: pcuSubmissions.id,
        submittedAt: pcuSubmissions.submittedAt,
        updatedAt: pcuSubmissions.updatedAt,
        barangay: pcuSubmissions.barangay,
        outcome: pcuSubmissions.submittedOutcome,
        classification: pcuSubmissions.classification,
        transactionNumber: pcuSubmissions.transactionNumber,
        pin: pcuSubmissions.extractedPin,
        firstName: pcuSubmissions.firstName,
        middleName: pcuSubmissions.middleName,
        lastName: pcuSubmissions.lastName,
        birthDate: pcuSubmissions.birthDate,
        assignedClinic: pcuSubmissions.assignedClinic,
        errorCode: pcuSubmissions.errorCode,
        verificationStatus: pcuSubmissions.verificationStatus,
      })
      .from(pcuSubmissions)
      .where(
        cursor
          ? gt(pcuSubmissions.id, cursor)
          : undefined
      )
      .orderBy(asc(pcuSubmissions.id))
      .limit(limit);

    const data = rows.map((record) => ({
      ...record,

      fullName: [
        record.firstName,
        record.middleName,
        record.lastName,
      ]
        .filter(Boolean)
        .join(" "),
    }));

    return NextResponse.json(
      {
        rows: data,

        nextCursor:
          rows.length === limit
            ? rows[rows.length - 1].id
            : null,
      },
      { headers }
    );
  } catch (error) {
    console.error("PCU_SHEETS_API_ERROR", {
      type:
        error instanceof Error
          ? error.name
          : "UnknownError",
    });

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
