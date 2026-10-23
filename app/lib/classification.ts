
export type PCUOutcome = "SUCCESS" | "FAILED";

export type PCUClassification =
  | "SUCCESS_SEBASTE"
  | "SUCCESS_OTHER_CLINIC"
  | "SUCCESS_NOT_ASSIGNED"
  | "SUCCESS_NO_CLINIC"
  | "FAILED"
  | "MANUAL_REVIEW";

export function classifyPCU(
  outcome: PCUOutcome,
  ocrText: string
): PCUClassification {
  if (outcome === "FAILED") {
    return "FAILED";
  }

  const text = ocrText
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  // OCR must contain recognizable success evidence.
  if (
    !/\b(SUCCESS|SUCCESSFUL|SUCCEEDED)\b/.test(text)
  ) {
    return "MANUAL_REVIEW";
  }

  if (
    /\b(NOT YET ASSIGNED|NOT ASSIGNED|UNASSIGNED)\b/.test(
      text
    )
  ) {
    return "SUCCESS_NOT_ASSIGNED";
  }

  const clinicMatch = text.match(
    /(?:ASSIGNED CLINIC|ASSIGNED FACILITY|HEALTH CARE PROVIDER|HEALTHCARE PROVIDER)\s*[:\-]?\s*([^\n\r]+)/i
  );

  if (!clinicMatch) {
    return "SUCCESS_NO_CLINIC";
  }

  const clinic = clinicMatch[1].trim();

  if (/SEBASTE/.test(clinic)) {
    return "SUCCESS_SEBASTE";
  }

  return "SUCCESS_OTHER_CLINIC";
}

export function getProcessingQueue(
  classification: PCUClassification
) {
  switch (classification) {
    case "SUCCESS_NOT_ASSIGNED":
      return "PKRF_REVIEW";

    case "FAILED":
      return "CEC_VERIFICATION";

    case "SUCCESS_SEBASTE":
    case "SUCCESS_OTHER_CLINIC":
    case "SUCCESS_NO_CLINIC":
    case "MANUAL_REVIEW":
      return "MANUAL_REVIEW";
  }
}
