
import type {
  AIExtractionResult,
} from "./types";

export interface PCUAIProvider {
  extract(
    image: Buffer,
    mimeType: "image/png" | "image/jpeg"
  ): Promise<AIExtractionResult>;
}
