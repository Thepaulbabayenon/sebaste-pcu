
import { NextResponse } from "next/server";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export async function GET() {
  const bucket = process.env.S3_BUCKET || "assets";
  const key = `tests/${crypto.randomUUID()}.txt`;

  const s3 = new S3Client({
    forcePathStyle: true,
  });

  let uploaded = false;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: "Sebaste PCU storage connection test",
        ContentType: "text/plain",
      })
    );

    uploaded = true;

    return NextResponse.json({
      connected: true,
      message: "Storage upload successful",
    });
  } catch (error) {
    const err = error as {
      name?: string;
      message?: string;
      $metadata?: {
        httpStatusCode?: number;
      };
    };

    console.error("Neon storage diagnostic:", {
      bucket,
      error: err.name,
      status: err.$metadata?.httpStatusCode,
      message: err.message,
    });

    return NextResponse.json(
      {
        connected: false,
        error: err.name ?? "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    if (uploaded) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      ).catch(() => {
        console.error("Test object cleanup failed");
      });
    }
  }
}
