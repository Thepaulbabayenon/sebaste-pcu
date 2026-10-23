
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/app/db";
import { getScreenshotUrl } from "@/app/lib/storage";
import { isAuthorizedWorker } from "@/app/lib/worker-auth";

const MAX_ATTEMPTS = 3;

// No `export const runtime = "nodejs"` here.
// Your project uses cacheComponents.

type ClaimRow = {
  id: string;
  screenshot_key: string;
  ai_lease_token: string;
  ai_attempts: number;
};

export async function POST(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    // A single atomic statement prevents workers
    // from claiming the same job simultaneously.
    const result = await db.execute(sql`
      WITH candidate AS (
        SELECT id
        FROM pcu_submissions
        WHERE submitted_outcome = 'SUCCESS'
          AND verification_status = 'PENDING'
          AND ai_attempts < ${MAX_ATTEMPTS}
          AND (
            ai_status = 'PENDING'
            OR (
              ai_status = 'PROCESSING'
              AND ai_lease_expires_at < NOW()
            )
          )
        ORDER BY submitted_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE pcu_submissions AS p
      SET
        ai_status = 'PROCESSING',
        ai_attempts = p.ai_attempts + 1,
        ai_lease_token = gen_random_uuid(),
        ai_lease_expires_at = NOW() + INTERVAL '10 minutes',
        ai_last_error = NULL,
        updated_at = NOW()
      FROM candidate
      WHERE p.id = candidate.id
      RETURNING
        p.id,
        p.screenshot_key,
        p.ai_lease_token,
        p.ai_attempts
    `);

    // Supports the common Drizzle driver result shapes.
    const raw = result as unknown as
      | { rows: ClaimRow[] }
      | ClaimRow[];

    const rows = Array.isArray(raw)
      ? raw
      : raw.rows;

    const job = rows?.[0];

    if (!job) {
      return NextResponse.json({
        success: true,
        job: null,
      });
    }

    const screenshotUrl = await getScreenshotUrl(
      job.screenshot_key
    );

    return NextResponse.json({
      success: true,
      job: {
        submissionId: job.id,
        leaseToken: job.ai_lease_token,
        screenshotUrl,
        attempt: Number(job.ai_attempts),
      },
    });
  } catch (error) {
    console.error("PCU_WORKER_CLAIM_FAILED", {
      code:
        error instanceof Error
          ? error.name
          : "UNKNOWN",
    });

    return NextResponse.json(
      { error: "Unable to claim an AI job." },
      { status: 500 }
    );
  }
}
