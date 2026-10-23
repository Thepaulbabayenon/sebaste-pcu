
import "server-only";

import sharp from "sharp";

import type { PCUAIProvider } from "./provider";

import type {
  AIExtractionResult,
  PCUExtraction,
} from "./types";

import { GeminiPCUProvider } from "./gemini";
import { LocalPCUProvider } from "./local-vlm";
import { HybridPCUProvider } from "./hybrid";

// ============================================
// PROVIDER SELECTION
// ============================================

function getProvider(): PCUAIProvider {
  const selected = (
    process.env.PCU_AI_PROVIDER ?? "local"
  )
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

  // Do not log raw environment variable values.
  // A previously misconfigured provider contained
  // a sensitive API credential.

  switch (selected) {
    case "local":
      return new LocalPCUProvider();

    case "gemini":
    case "hybrid": {
      if (
        process.env.PCU_EXTERNAL_AI_APPROVED !==
        "true"
      ) {
        throw new Error(
          "EXTERNAL_AI_PROCESSING_NOT_APPROVED"
        );
      }

      if (!process.env.GEMINI_API_KEY) {
        throw new Error(
          "GEMINI_API_KEY_NOT_CONFIGURED"
        );
      }

      return selected === "hybrid"
        ? new HybridPCUProvider()
        : new GeminiPCUProvider();
    }

    default:
      throw new Error(
        "UNKNOWN_PCU_AI_PROVIDER"
      );
  }
}

// ============================================
// TEXT NORMALIZATION
// ============================================

function cleanText(
  value: string | null
): string | null {
  if (value === null) {
    return null;
  }

  const cleaned = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function cleanName(
  value: string | null
): string | null {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return null;
  }

  // Reject obvious structural or control data
  // rather than silently modifying names.
  if (
    cleaned.length > 100 ||
    /[\u0000-\u001F]/.test(cleaned)
  ) {
    return null;
  }

  return cleaned;
}

// ============================================
// DATE VALIDATION
// ============================================

function validISODate(
  value: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);

  if (
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day &&
    date.getTime() <= Date.now()
  );
}

// ============================================
// EXTRACTION VALIDATION
// ============================================

function validateExtraction(
  input: PCUExtraction
): {
  data: PCUExtraction;
  warnings: string[];
} {
  const warnings: string[] = [];

  const data: PCUExtraction = {
    transactionNumber: cleanText(
      input.transactionNumber
    ),
    pin: cleanText(input.pin),
    firstName: cleanName(input.firstName),
    middleName: cleanName(input.middleName),
    lastName: cleanName(input.lastName),
    birthDate: cleanText(input.birthDate),
    errorCode: cleanText(input.errorCode),
    assignedClinic: cleanText(
      input.assignedClinic
    ),
  };

  // ========================================
  // PHILHEALTH PIN
  // ========================================

  if (data.pin) {
    const normalized = data.pin.replace(
      /[\s-]/g,
      ""
    );

    if (/^\d{12}$/.test(normalized)) {
      data.pin = normalized;
    } else {
      data.pin = null;

      warnings.push(
        "PhilHealth PIN format is invalid"
      );
    }
  } else {
    warnings.push(
      "PhilHealth PIN was not extracted"
    );
  }

  // ========================================
  // TRANSACTION NUMBER
  // ========================================

  if (data.transactionNumber) {
    const normalized = data.transactionNumber
      .toUpperCase()
      .replace(/[\s-]/g, "");

    // General validation; not an official
    // PhilHealth transaction-number specification.
    if (/^[A-Z0-9]{8,32}$/.test(normalized)) {
      data.transactionNumber = normalized;

      warnings.push(
        "Transaction number requires RHU visual verification"
      );
    } else {
      data.transactionNumber = null;

      warnings.push(
        "Transaction number format is invalid"
      );
    }
  } else {
    warnings.push(
      "Transaction number was not extracted"
    );
  }

  // ========================================
  // PATIENT NAMES
  // ========================================

  if (!data.firstName) {
    warnings.push(
      "First name requires verification"
    );
  }

  if (!data.lastName) {
    warnings.push(
      "Last name requires verification"
    );
  }

  // Middle name can legitimately be blank.

  // ========================================
  // BIRTHDATE
  // ========================================

  if (data.birthDate) {
    if (!validISODate(data.birthDate)) {
      data.birthDate = null;

      warnings.push(
        "Birthdate is invalid or unreadable"
      );
    }
  } else {
    warnings.push(
      "Birthdate was not extracted"
    );
  }

  // ========================================
  // YAKAP CLINIC
  // ========================================

  if (data.assignedClinic) {
    if (data.assignedClinic.length > 500) {
      data.assignedClinic = null;

      warnings.push(
        "YAKAP clinic value is too long"
      );
    }
  } else {
    warnings.push(
      "YAKAP clinic was not extracted"
    );
  }

  // ========================================
  // ERROR CODE
  // ========================================

  if (
    data.errorCode &&
    data.errorCode.length > 100
  ) {
    data.errorCode = null;

    warnings.push(
      "Error code value is invalid"
    );
  }

  return {
    data,
    warnings,
  };
}

// ============================================
// MAIN EXTRACTION FUNCTION
// ============================================

export async function extractWithAI(
  buffer: Buffer
): Promise<AIExtractionResult> {
  // ========================================
  // 1. IMAGE VALIDATION
  // ========================================

  const metadata = await sharp(buffer, {
    limitInputPixels: 20_000_000,
  }).metadata();

  if (
    metadata.format !== "png" &&
    metadata.format !== "jpeg"
  ) {
    throw new Error(
      "UNSUPPORTED_IMAGE_FORMAT"
    );
  }

  const mimeType:
    | "image/png"
    | "image/jpeg" =
    metadata.format === "png"
      ? "image/png"
      : "image/jpeg";

  // ========================================
  // 2. SELECT AI PROVIDER
  // ========================================

  const provider = getProvider();

  // ========================================
  // 3. PROCESS SCREENSHOT
  // ========================================

  const result = await provider.extract(
    buffer,
    mimeType
  );

  // ========================================
  // 4. VALIDATE EXTRACTION
  // ========================================

  const validated = validateExtraction(
    result.data
  );

  // ========================================
  // 5. SAFE DIAGNOSTICS
  // ========================================

  console.log("PCU AI extraction:", {
    provider: result.provider,

    hasTransaction: Boolean(
      validated.data.transactionNumber
    ),

    hasPin: Boolean(
      validated.data.pin
    ),

    hasBirthDate: Boolean(
      validated.data.birthDate
    ),

    hasFirstName: Boolean(
      validated.data.firstName
    ),

    hasLastName: Boolean(
      validated.data.lastName
    ),

    hasAssignedClinic: Boolean(
      validated.data.assignedClinic
    ),

    warningCount:
      validated.warnings.length,
  });

  // ========================================
  // 6. RETURN STANDARDIZED DATA
  // ========================================

  return {
    provider: result.provider,

    data: validated.data,

    warnings: [
      ...result.warnings,
      ...validated.warnings,
    ],
  };
}
