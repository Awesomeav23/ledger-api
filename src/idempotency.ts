import { Request } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import { HttpError } from "./errors";

// Keys must be 1–255 characters. Clients usually send a UUID.
const keySchema = z.string().trim().min(1).max(255);

// Reads the Idempotency-Key header from the request.
// Returns 400 if the header is missing or too long.
export function getIdempotencyKey(req: Request): string {
  const result = keySchema.safeParse(req.header("Idempotency-Key"));
  if (!result.success) throw new HttpError(400, "idempotency_key_required");
  return result.data;
}

// Creates a fingerprint (SHA-256 hash) of the request body.
// The same body always produces the same hash, so a retry can be matched
// to the original request, and a reused key with different data can be caught.
export function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
