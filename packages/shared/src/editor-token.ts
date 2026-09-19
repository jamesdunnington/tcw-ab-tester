import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/**
 * Short-lived token that lets a hub admin open the visual editor on a
 * WordPress page (docs/PLAN.md section 7). The hub signs it with the site
 * secret; the plugin (includes/class-editor-bridge.php, the PHP mirror of this
 * file) verifies it with the same secret. Keep the two in sync.
 *
 * token = base64url(payloadJson) + "." + hex(HMAC-SHA256(secret, "tcwab-editor\n" + base64url(payloadJson)))
 *
 * The fixed "tcwab-editor" prefix domain-separates this from request
 * signatures (hmac.ts), so a signed API request can never be replayed as an
 * editor token. The token only proves the hub sent the admin here; the plugin
 * still requires a logged-in WordPress user with edit_pages.
 */

export const EDITOR_TOKEN_TTL_SECONDS = 300;
const DOMAIN = "tcwab-editor\n";

export interface EditorTokenPayload {
  /** Public site key the token was minted for. */
  sk: string;
  /** Test being edited. */
  t: string;
  /** Variant being edited. */
  v: string;
  /** Expiry, unix seconds. */
  exp: number;
  /** Random id; lets the hub trace a token, not a replay guard (TTL is the guard). */
  n: string;
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", secret).update(DOMAIN + body, "utf8").digest("hex");
}

export function signEditorToken(
  input: { siteKey: string; testId: string; variantKey: string; secret: string },
  now: number = Math.floor(Date.now() / 1000),
): string {
  const payload: EditorTokenPayload = {
    sk: input.siteKey,
    t: input.testId,
    v: input.variantKey,
    exp: now + EDITOR_TOKEN_TTL_SECONDS,
    n: randomUUID(),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${mac(input.secret, body)}`;
}

export type EditorTokenResult =
  | { ok: true; payload: EditorTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_site" };

export function verifyEditorToken(
  token: string,
  secret: string,
  expectedSiteKey: string,
  now: number = Math.floor(Date.now() / 1000),
): EditorTokenResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;

  const expected = Buffer.from(mac(secret, body), "hex");
  const actual = Buffer.from(sig, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "bad_signature" };

  let payload: EditorTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || typeof payload.sk !== "string") return { ok: false, reason: "malformed" };
  if (payload.sk !== expectedSiteKey) return { ok: false, reason: "wrong_site" };
  if (now > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
