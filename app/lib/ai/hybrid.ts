
import "server-only";

import type { PCUAIProvider } from "./provider";
import type { AIExtractionResult } from "./types";

import { GeminiPCUProvider } from "./gemini";
import { LocalPCUProvider } from "./local-vlm";

function isQuotaError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const err = error as {
    status?: number;
    code?: number | string;
  };

  return (
    err.status === 429 ||
    err.code === 429 ||
    err.code === "RESOURCE_EXHAUSTED"
  );
}

export class HybridPCUProvider implements PCUAIProvider {
  private gemini = new GeminiPCUProvider();
  private local = new LocalPCUProvider();

  async extract(
    image: Buffer,
    mimeType: "image/png" | "image/jpeg"
  ): Promise<AIExtractionResult> {
    try {
      return await this.gemini.extract(
        image,
        mimeType
      );
    } catch (error: unknown) {
      if (!isQuotaError(error)) {
        throw error;
      }

      console.warn(
        "Gemini quota exceeded; switching to local Gemma"
      );

      return await this.local.extract(
        image,
        mimeType
      );
    }
  }
}
