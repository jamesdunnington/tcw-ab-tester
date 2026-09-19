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
/** A session can be renewed (see renewEditorToken) for at most this long after it started. */
export const EDITOR_SESSION_MAX_SECONDS = 8 * 3600;
const DOMAIN = "tcwab-editor\n";

/** "editor" opens the visual editor; "heatmap" opens the read-only heatmap overlay. Tokens minted before kinds existed have none and mean "editor". */
export type EditorTokenKind = "editor" | "heatmap";

export interface EditorTokenPayload {
  /** Public site key the token was minted for. */
  sk: string;
  /** Test being edited. */
  t: string;
  /** Variant being edited. */
  v: string;
  /** Expiry, unix seconds. */
  exp: number;
  /** When the editing session first started; renewals keep it so the session cap can't be dodged. */
  iat?: number;
  /** What the token opens; absent means "editor". A heatmap token cannot write ops and an editor token cannot read heat data. */
  k?: EditorTokenKind;
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
  input: { siteKey: string; testId: string; variantKey: string; secret: string; iat?: number; kind?: EditorTokenKind },
  now: number = Math.floor(Date.now() / 1000),
): string {
  const payload: EditorTokenPayload = {
    sk: input.siteKey,
    t: input.testId,
    v: input.variantKey,
    exp: now + EDITOR_TOKEN_TTL_SECONDS,
    iat: input.iat ?? now,
    ...(input.kind && input.kind !== "editor" ? { k: input.kind } : {}),
    n: randomUUID(),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${mac(input.secret, body)}`;
}

export type EditorTokenFailure = "malformed" | "bad_signature" | "expired" | "wrong_site" | "wrong_kind";

export type EditorTokenResult = { ok: true; payload: EditorTokenPayload } | { ok: false; reason: EditorTokenFailure };

export function verifyEditorToken(
  token: string,
  secret: string,
  expectedSiteKey: string,
  now: number = Math.floor(Date.now() / 1000),
  kind: EditorTokenKind | "any" = "editor",
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
  if (kind !== "any" && (payload.k ?? "editor") !== kind) return { ok: false, reason: "wrong_kind" };
  return { ok: true, payload };
}

/**
 * Issues a fresh token for the same test/variant while the editor is open. The
 * old token must still be valid, and the session may not exceed
 * EDITOR_SESSION_MAX_SECONDS from its first issue.
 */
export function renewEditorToken(
  token: string,
  secret: string,
  expectedSiteKey: string,
  now: number = Math.floor(Date.now() / 1000),
): { ok: true; token: string; payload: EditorTokenPayload } | { ok: false; reason: EditorTokenFailure | "session_too_long" } {
  const v = verifyEditorToken(token, secret, expectedSiteKey, now, "any");
  if (!v.ok) return v;
  const iat = v.payload.iat ?? v.payload.exp - EDITOR_TOKEN_TTL_SECONDS;
  if (now - iat > EDITOR_SESSION_MAX_SECONDS) return { ok: false, reason: "session_too_long" };
  const next = signEditorToken({ siteKey: v.payload.sk, testId: v.payload.t, variantKey: v.payload.v, secret, iat, kind: v.payload.k }, now);
  return { ok: true, token: next, payload: JSON.parse(Buffer.from(next.split(".")[0], "base64url").toString("utf8")) };
}
