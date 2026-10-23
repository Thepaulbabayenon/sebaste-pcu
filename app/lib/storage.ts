
import "server-only";

import { randomUUID } from "node:crypto";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// =====================================================
// STORAGE CONFIGURATION
// =====================================================

const endpoint = process.env.AWS_ENDPOINT_URL_S3;
const region = process.env.AWS_REGION;

// Preserve the existing bucket name.
// A configured S3_BUCKET may override it.
const bucket = process.env.S3_BUCKET || "assets";

if (!endpoint || !region) {
  throw new Error(
    "Missing storage configuration: " +
      "AWS_ENDPOINT_URL_S3 or AWS_REGION"
  );
}

// =====================================================
// S3 CLIENT
// =====================================================

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,

  // AWS SDK resolves credentials from supported
  // server-side environment / credential providers.
  // Do not put credentials in client-side code.
});

// =====================================================
// VERIFY STORAGE CONNECTION
// =====================================================

export async function verifyStorageConnection():
  Promise<boolean> {
  try {
    await s3.send(
      new HeadBucketCommand({
        Bucket: bucket,
      })
    );

    return true;
  } catch (error: unknown) {
    const err = error as {
      name?: string;
      $metadata?: {
        httpStatusCode?: number;
      };
    };

    console.error("Storage connection failed:", {
      error: err.name ?? "UNKNOWN",
      status:
        err.$metadata?.httpStatusCode ?? null,
    });

    throw error;
  }
}

// =====================================================
// SAVE PRIVATE SCREENSHOT
// =====================================================

export async function saveScreenshot(
  buffer: Buffer,
  contentType: string
): Promise<string> {
  if (
    contentType !== "image/png" &&
    contentType !== "image/jpeg"
  ) {
    throw new Error(
      "UNSUPPORTED_SCREENSHOT_CONTENT_TYPE"
    );
  }

  if (buffer.length === 0) {
    throw new Error("EMPTY_SCREENSHOT");
  }

  const extension =
    contentType === "image/png" ? "png" : "jpg";

  const key =
    `pcu-screenshots/${randomUUID()}.${extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "private, no-store",
    })
  );

  return key;
}

// =====================================================
// SHORT-LIVED PRIVATE DOWNLOAD URL
// =====================================================

export async function getScreenshotUrl(
  key: string
): Promise<string> {
  if (
    !key.startsWith("pcu-screenshots/") ||
    key.includes("..")
  ) {
    throw new Error(
      "INVALID_SCREENSHOT_KEY"
    );
  }

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    {
      expiresIn: 300,
    }
  );
}

// =====================================================
// DELETE SCREENSHOT
// =====================================================

export async function deleteScreenshot(
  key: string
): Promise<void> {
  if (
    !key.startsWith("pcu-screenshots/") ||
    key.includes("..")
  ) {
    throw new Error(
      "INVALID_SCREENSHOT_KEY"
    );
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
