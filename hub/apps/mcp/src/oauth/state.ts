import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The login page is stateless: everything about the pending authorization request travels in a
 * signed, short-lived token in a hidden form field, so nothing is stored until the user approves.
 */
export interface PendingAuthorization {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string;
  resource?: string;
  exp: number; // epoch ms
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function signPending(p: PendingAuthorization, secret: string): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifyPending(token: string, secret: string, now = Date.now()): PendingAuthorization | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PendingAuthorization;
    return typeof p.exp === "number" && p.exp > now ? p : null;
  } catch {
    return null;
  }
}
