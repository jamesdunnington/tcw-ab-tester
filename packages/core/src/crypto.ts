import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getSecretKey } from "./context.js";

/**
 * Reversible AES-256-GCM encryption for site secrets (see db/schema.ts
 * sites.secretEncrypted for why this must be reversible rather than
 * hashed). NOT for passwords — see auth.ts for one-way password hashing.
 */

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error("malformed_encrypted_secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", getSecretKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}
