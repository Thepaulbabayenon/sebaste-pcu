
import "server-only";

import {
  createHash,
  timingSafeEqual,
} from "node:crypto";

export function isAuthorizedWorker(request: Request) {
  const expected = process.env.PCU_WORKER_SECRET;
  const supplied = request.headers.get("x-worker-secret");

  if (!expected || !supplied || expected.length < 32) {
    return false;
  }

  const hash = (value: string) =>
    createHash("sha256").update(value).digest();

  return timingSafeEqual(hash(expected), hash(supplied));
}
