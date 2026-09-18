import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * One-way password hashing for hub admin (dashboard) login. Distinct from
 * site-secret handling in crypto.ts, which must be reversible.
 * Format: "scrypt:<saltHex>:<hashHex>".
 */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export const SESSION_COOKIE_NAME = "tcw_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
