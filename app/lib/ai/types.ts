
import { z } from "zod";

export const PCUExtractionSchema = z.object({
  transactionNumber: z.string().nullable(),
  pin: z.string().nullable(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  birthDate: z.string().nullable(),
  errorCode: z.string().nullable(),
  assignedClinic: z.string().nullable(),
});

export type PCUExtraction = z.infer<
  typeof PCUExtractionSchema
>;

export type AIProviderName = "gemini" | "local";

export type AIExtractionResult = {
  data: PCUExtraction;
  provider: AIProviderName;
  warnings: string[];
};

export function emptyPCUExtraction(): PCUExtraction {
  return {
    transactionNumber: null,
    pin: null,
    firstName: null,
    middleName: null,
    lastName: null,
    birthDate: null,
    errorCode: null,
    assignedClinic: null,
  };
}
