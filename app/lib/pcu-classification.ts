
import type { pcuSubmissions } from "@/app/db/schema";

export type PCUClassification =
  typeof pcuSubmissions.$inferInsert["classification"];

export type PCUExtractedFields = {
  transactionNumber: string | null;
  pin: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  birthDate: string | null;
  assignedClinic: string | null;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function validDate(value: string | null) {
  const date = normalize(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;

  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}

function hasCompleteDetails(data: PCUExtractedFields) {
  return (
    /^\d{12}$/.test(normalize(data.pin)) &&
    normalize(data.firstName).length > 0 &&
    normalize(data.lastName).length > 0 &&
    validDate(data.birthDate) &&
    normalize(data.transactionNumber).length > 0
  );
}

function isNotAssigned(value: string) {
  return /^(?:not\s*(?:yet\s*)?assigned|unassigned|no\s*(?:assigned\s*)?(?:clinic|facility))(?:[.!])?$/i.test(value);
}

function isSebasteClinic(value: string) {
  if (/\b(?:not assigned|unassigned|not registered)\b/i.test(value)) {
    return false;
  }

  return (
    /\bsebaste\b/i.test(value) &&
    /\b(?:yakap|clinic|rhu|rural health unit|health center)\b/i.test(value)
  );
}

export function classifyPCU(
  outcome: "SUCCESS" | "FAILED",
  extracted: PCUExtractedFields
): PCUClassification {
  if (outcome === "FAILED") return "FAILED";

  if (!hasCompleteDetails(extracted)) {
    return "MANUAL_REVIEW";
  }

  const clinic = normalize(extracted.assignedClinic);

  if (isNotAssigned(clinic)) return "SUCCESS_NOT_ASSIGNED";
  if (isSebasteClinic(clinic)) return "SUCCESS_SEBASTE";
  if (!clinic) return "SUCCESS_NO_CLINIC";

  return "SUCCESS_OTHER_CLINIC";
}
