
import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { asc, gt } from "drizzle-orm";

import { db } from "@/app/db";
import { pcuSubmissions } from "@/app/db/schema";

// Compatible with Next.js Cache Components.
// No runtime or dynamic route exports.

// =====================================================
// AUTHENTICATION
// =====================================================

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

// =====================================================
// GET /api/internal/sheets
// =====================================================

export async function GET(request: NextRequest) {
  const headers = {
    "Cache-Control": "private, no-store",
  };

  // ---------------------------------------------------
  // 1. AUTHENTICATE APPS SCRIPT
  // ---------------------------------------------------

  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers }
    );
  }

  try {
    // -------------------------------------------------
    // 2. PAGINATION
    // -------------------------------------------------

    const cursor =
      request.nextUrl.searchParams.get("after");

    const limit = 200;

    if (
      cursor &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        cursor
      )
    ) {
      return NextResponse.json(
        { error: "Invalid cursor" },
        { status: 400, headers }
      );
    }

    // -------------------------------------------------
    // 3. FETCH SUBMISSIONS FROM NEON
    // -------------------------------------------------

    const rows = await db
      .select({
        id: pcuSubmissions.id,

        submittedAt:
          pcuSubmissions.submittedAt,

        updatedAt:
          pcuSubmissions.updatedAt,

        barangay:
          pcuSubmissions.barangay,

        // NEW:
        // Name of the BHW or encoder
        // who originally submitted the screenshot.
        submittedBy:
          pcuSubmissions.submittedBy,

        outcome:
          pcuSubmissions.submittedOutcome,

        classification:
          pcuSubmissions.classification,

        transactionNumber:
          pcuSubmissions.transactionNumber,

        pin:
          pcuSubmissions.extractedPin,

        firstName:
          pcuSubmissions.firstName,

        middleName:
          pcuSubmissions.middleName,

        lastName:
          pcuSubmissions.lastName,

        birthDate:
          pcuSubmissions.birthDate,

        assignedClinic:
          pcuSubmissions.assignedClinic,

        errorCode:
          pcuSubmissions.errorCode,

        verificationStatus:
          pcuSubmissions.verificationStatus,
      })
      .from(pcuSubmissions)
      .where(
        cursor
          ? gt(pcuSubmissions.id, cursor)
          : undefined
      )
      .orderBy(
        asc(pcuSubmissions.id)
      )
      .limit(limit);

    // -------------------------------------------------
    // 4. PREPARE DATA FOR GOOGLE APPS SCRIPT
    // -------------------------------------------------

    const data = rows.map((record) => ({
      ...record,

      // Patient name is separate from Submitted By.
      fullName: [
        record.firstName,
        record.middleName,
        record.lastName,
      ]
        .filter(Boolean)
        .join(" "),
    }));

    // -------------------------------------------------
    // 5. RETURN DATA
    // -------------------------------------------------

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
  } catch (error: unknown) {
    // Do not log patient information or secrets.

    console.error("PCU_SHEETS_API_ERROR", {
      type:
        error instanceof Error
          ? error.name
          : "UnknownError",
    });

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500, headers }
    );
  }
}
