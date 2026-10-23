
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { z } from "zod";

config({ path: ".env.local" });

const Schema = z.object({
  transactionNumber: z.string().nullable(),
  pin: z.string().nullable(),
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  birthDate: z.string().nullable(),
  errorCode: z.string().nullable(),
  assignedClinic: z.string().nullable(),
});

async function main() {
  const imagePath = process.argv[2];
  const submissionId = process.argv[3];

  if (!imagePath || !submissionId) {
    throw new Error(
      "Usage: npx tsx scripts/test-local-ollama.ts " +
      "<image-path> <test-submission-uuid>"
    );
  }

  const apiUrl = process.env.PCU_API_URL;
  const secret = process.env.PCU_WORKER_SECRET;

  if (!apiUrl || !secret) {
    throw new Error("Missing worker configuration");
  }

  const image = await readFile(imagePath);

  const prompt = `
Extract the PCU screenshot into JSON.

Return these exact fields:
transactionNumber, pin, firstName, middleName,
lastName, birthDate, errorCode, assignedClinic.

Each field must be a string or null.
Preserve all identifier characters.
Combine transaction numbers wrapped across lines.
Use YYYY-MM-DD for birthDate.
Never invent missing information.
`;

  const response = await fetch(
    "http://127.0.0.1:11434/api/chat",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemma3:4b",
        stream: false,
        format: "json",
        messages: [{
          role: "user",
          content: prompt,
          images: [image.toString("base64")],
        }],
        options: {
          temperature: 0,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const result = await response.json();

  const extracted = Schema.parse(
    JSON.parse(result.message.content)
  );

  const save = await fetch(
    `${apiUrl.replace(/\/$/, "")}/api/internal/worker/result`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": secret,
      },
      body: JSON.stringify({
        submissionId,
        extraction: extracted,
      }),
    }
  );

  if (!save.ok) {
    throw new Error(
      `Neon update API returned ${save.status}`
    );
  }

  console.log({
    saved: true,
    submissionId,
    hasTransaction: Boolean(extracted.transactionNumber),
    hasPin: Boolean(extracted.pin),
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
