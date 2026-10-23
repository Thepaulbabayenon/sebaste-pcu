
import "server-only";

import { extractWithAI } from "./ai/extract-pcu";

export type ExtractedPCU = {
  rawText: string;
  transactionNumber: string | null;
  pin: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthDate: string | null;
  errorCode: string | null;
  assignedClinic: string | null;
  warnings: string[];
};

export async function extractPCUData(
  buffer: Buffer
): Promise<ExtractedPCU> {
  const result = await extractWithAI(buffer);

  return {
    // This is intentionally empty.
    // Structured VLM output is not full-page OCR text.
    rawText: "",
    transactionNumber:
      result.data.transactionNumber,
    pin: result.data.pin,
    firstName: result.data.firstName,
    middleName: result.data.middleName,
    lastName: result.data.lastName,
    birthDate: result.data.birthDate,
    errorCode: result.data.errorCode,
    assignedClinic: result.data.assignedClinic,
    warnings: result.warnings,
  };
}
