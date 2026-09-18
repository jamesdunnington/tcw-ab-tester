import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/**
 * HMAC signing scheme shared between the hub API and the WordPress plugin
 * (see wp-plugin/tcw-ab-tester/includes/class-hub-client.php for the PHP
 * mirror of this exact algorithm — keep the two in sync).
 *
 * signature = HMAC-SHA256(secret, `${method}\n${path}\n${timestamp}\n${nonce}\n${sha256(body)}`)
 *
 * - method/path are uppercase HTTP method + the request path (no host/query).
 * - timestamp is a unix-seconds string; requests older/newer than the
 *   allowed skew are rejected.
 * - nonce is a random per-request string; the verifying side must reject a
 *   nonce it has already seen within the timestamp window (replay guard is
 *   the caller's responsibility — see hub/apps/api/src/lib/hmac.ts).
 */

export const SIGNATURE_SKEW_SECONDS = 300; // 5 minutes

export interface SignInput {
  method: string;
  path: string;
  body: string;
  secret: string;
  timestamp?: string;
  nonce?: string;
}

export interface SignedRequest {
  timestamp: string;
  nonce: string;
  signature: string;
}

function bodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function buildMessage(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash(body)].join("\n");
}

export function signRequest(input: SignInput): SignedRequest {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = input.nonce ?? randomUUID();
  const message = buildMessage(input.method, input.path, timestamp, nonce, input.body);
  const signature = createHmac("sha256", input.secret).update(message, "utf8").digest("hex");
  return { timestamp, nonce, signature };
}

export interface VerifyInput extends SignedRequest {
  method: string;
  path: string;
  body: string;
  secret: string;
  /** Unix seconds "now"; injectable for tests. */
  now?: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "stale_timestamp" | "bad_signature" | "malformed" };

export function verifyRequest(input: VerifyInput): VerifyResult {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "malformed" };
  if (Math.abs(now - ts) > SIGNATURE_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };

  const message = buildMessage(input.method, input.path, input.timestamp, input.nonce, input.body);
  const expected = createHmac("sha256", input.secret).update(message, "utf8").digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(input.signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(expectedBuf, actualBuf)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

/** Generates a new random site key (public identifier) and secret (never sent back after creation). */
export function generateSiteCredentials(): { siteKey: string; siteSecret: string } {
  const siteKey = `tcw_${randomUUID().replace(/-/g, "")}`;
  const siteSecret = createHash("sha512")
    .update(randomUUID() + randomUUID())
    .digest("hex");
  return { siteKey, siteSecret };
}
