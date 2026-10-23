
import "server-only";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const endpoint = process.env.AWS_ENDPOINT_URL_S3;
const region = process.env.AWS_REGION;
const bucket = "assets";

if (!endpoint || !region || !bucket) {
  throw new Error(
    "Missing Neon Object Storage configuration. Check AWS_ENDPOINT_URL_S3, AWS_REGION and S3_BUCKET."
  );
}

const s3 = new S3Client({
  forcePathStyle: true,
});

export async function verifyStorageConnection() {
  try {
    await s3.send(
      new HeadBucketCommand({
        Bucket: bucket,
      })
    );

    return true;
  } catch (error) {
    const err = error as {
      name?: string;
      message?: string;
      $metadata?: {
        httpStatusCode?: number;
      };
    };

    console.error("Storage connection failed:", {
      bucket,
      error: err.name,
      status: err.$metadata?.httpStatusCode,
      message: err.message,
    });

    throw error;
  }
}

export async function saveScreenshot(
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const extension =
    contentType === "image/png" ? "png" : "jpg";

  const key =
    `pcu-screenshots/${crypto.randomUUID()}.${extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return key;
}

export async function getScreenshotUrl(
  key: string
): Promise<string> {
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

export async function deleteScreenshot(
  key: string
): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}
