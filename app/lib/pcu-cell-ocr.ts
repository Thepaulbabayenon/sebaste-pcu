
import "server-only";

import sharp from "sharp";
import type { Worker } from "tesseract.js";

type Region = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// Coordinates relative to the 720 x 1612
// example PCU success screenshot.
const REFERENCE_WIDTH = 720;
const REFERENCE_HEIGHT = 1612;

const REGIONS = {
  transaction: {
    left: 415,
    top: 244,
    width: 255,
    height: 124,
  },
  birthDate: {
    left: 415,
    top: 795,
    width: 255,
    height: 130,
  },
};

async function recognizeRegion(
  buffer: Buffer,
  worker: Worker,
  region: Region
): Promise<string> {
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    return "";
  }

  const scaleX = metadata.width / REFERENCE_WIDTH;
  const scaleY = metadata.height / REFERENCE_HEIGHT;

  const left = Math.round(region.left * scaleX);
  const top = Math.round(region.top * scaleY);

  const width = Math.min(
    Math.round(region.width * scaleX),
    metadata.width - left
  );

  const height = Math.min(
    Math.round(region.height * scaleY),
    metadata.height - top
  );

  if (width <= 0 || height <= 0) {
    return "";
  }

  const cropped = await sharp(buffer)
    .extract({
      left,
      top,
      width,
      height,
    })
    .resize({
      width: width * 3,
    })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();

  const result = await worker.recognize(cropped);

  return result.data.text.trim();
}

function parseTransaction(
  value: string
): string | null {
  // Join multiline values and remove OCR whitespace.
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  // Candidate based on the transaction format
  // visible in the supplied PCU screenshot.
  const match = compact.match(/P\d{12,20}/);

  return match?.[0] ?? null;
}

function parseBirthDate(
  value: string
): string | null {
  const normalized = value.replace(/\s+/g, " ");

  const match = normalized.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*,?\s*(19\d{2}|20\d{2})\b/i
  );

  if (!match) return null;

  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];

  const month =
    months.indexOf(match[1].toLowerCase()) + 1;

  const day = Number(match[2]);
  const year = Number(match[3]);

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date > new Date()
  ) {
    return null;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export async function extractPCUCells(
  buffer: Buffer,
  worker: Worker
): Promise<{
  transactionNumber: string | null;
  birthDate: string | null;
}> {
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    return {
      transactionNumber: null,
      birthDate: null,
    };
  }

  // Only use these coordinates on screenshots
  // matching the reference screenshot geometry.
  // Other layouts must use the existing fallback.
  const aspect = metadata.width / metadata.height;
  const referenceAspect =
    REFERENCE_WIDTH / REFERENCE_HEIGHT;

  if (Math.abs(aspect - referenceAspect) > 0.02) {
    return {
      transactionNumber: null,
      birthDate: null,
    };
  }

  const transactionText = await recognizeRegion(
    buffer,
    worker,
    REGIONS.transaction
  );

  const birthDateText = await recognizeRegion(
    buffer,
    worker,
    REGIONS.birthDate
  );

  return {
    transactionNumber:
      parseTransaction(transactionText),
    birthDate:
      parseBirthDate(birthDateText),
  };
}
