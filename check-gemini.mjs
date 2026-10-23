
import { config } from "dotenv";
import { GoogleGenAI } from "@google/genai";

// Load Next.js environment configuration.
config({ path: ".env.local", override: true });

const apiKey = process.env.GEMINI_API_KEY;
const requestedModel = process.env.GEMINI_MODEL;

if (!apiKey) {
  console.error("GEMINI_API_KEY is missing");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    apiVersion: "v1beta",
  },
});

console.log("Gemini diagnostic:", {
  model: requestedModel,
  hasApiKey: true,
  apiVersion: "v1beta",
});

try {
  const models = await ai.models.list();

  const available = [];

  for await (const model of models) {
    const name = model.name ?? "";

    if (
      name.includes("flash") &&
      !name.includes("image") &&
      !name.includes("live") &&
      !name.includes("tts")
    ) {
      available.push(name);
    }
  }

  console.log("Visible Flash models:");
  console.log(available);

  if (available.length === 0) {
    console.log(
      "No Flash models found. Check your API key/project."
    );
    process.exit(1);
  }

  const selected = requestedModel
    ? available.find(
        (name) =>
          name === requestedModel ||
          name === `models/${requestedModel}`
      )
    : undefined;

  if (!selected) {
    console.log(
      "Configured model not found in the visible list."
    );
    process.exit(1);
  }

  const modelName = selected.replace(/^models\//, "");

  console.log("Testing text-only generation:", modelName);

  const result = await ai.models.generateContent({
    model: modelName,
    contents: "Reply with exactly OK.",
  });

  console.log("Generation successful:", {
    receivedText: Boolean(result.text),
  });
} catch (error) {
  console.error("Gemini diagnostic failed:", {
    status: error?.status ?? null,
    name: error?.name ?? "UNKNOWN",
  });

  process.exitCode = 1;
}
