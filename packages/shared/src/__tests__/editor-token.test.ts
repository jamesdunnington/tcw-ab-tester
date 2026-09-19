import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signEditorToken, verifyEditorToken, renewEditorToken, EDITOR_TOKEN_TTL_SECONDS, EDITOR_SESSION_MAX_SECONDS } from "../editor-token.js";

const secret = "s3cret";
const siteKey = "tcw_abc";
const base = { siteKey, testId: "11111111-1111-4111-8111-111111111111", variantKey: "b", secret };
const NOW = 1_800_000_000;

describe("editor token", () => {
  it("round-trips and carries the test/variant", () => {
    const r = verifyEditorToken(signEditorToken(base, NOW), secret, siteKey, NOW + 10);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.t).toBe(base.testId);
      expect(r.payload.v).toBe("b");
      expect(r.payload.exp).toBe(NOW + EDITOR_TOKEN_TTL_SECONDS);
    }
  });

  it("expires after the TTL", () => {
    const t = signEditorToken(base, NOW);
    expect(verifyEditorToken(t, secret, siteKey, NOW + EDITOR_TOKEN_TTL_SECONDS).ok).toBe(true);
    const late = verifyEditorToken(t, secret, siteKey, NOW + EDITOR_TOKEN_TTL_SECONDS + 1);
    expect(late).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects the wrong secret, a tampered payload and a different site", () => {
    const t = signEditorToken(base, NOW);
    expect(verifyEditorToken(t, "other", siteKey, NOW)).toEqual({ ok: false, reason: "bad_signature" });

    const [body, sig] = t.split(".");
    const forged = { ...JSON.parse(Buffer.from(body, "base64url").toString()), v: "a" };
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(verifyEditorToken(`${forgedBody}.${sig}`, secret, siteKey, NOW)).toEqual({ ok: false, reason: "bad_signature" });

    expect(verifyEditorToken(t, secret, "tcw_other", NOW)).toEqual({ ok: false, reason: "wrong_site" });
  });

  it("rejects malformed input", () => {
    expect(verifyEditorToken("nope", secret, siteKey, NOW).ok).toBe(false);
    expect(verifyEditorToken("a.b.c", secret, siteKey, NOW).ok).toBe(false);
    expect(verifyEditorToken("abc.zz", secret, siteKey, NOW).ok).toBe(false);
  });

  it("is domain-separated from request signatures", () => {
    // A MAC over the same body without the tcwab-editor prefix must not verify.
    const t = signEditorToken(base, NOW);
    const body = t.split(".")[0];
    const plain = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyEditorToken(`${body}.${plain}`, secret, siteKey, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("verifies a token built the way the PHP mirror builds it", () => {
    // PHP: hash_hmac('sha256', "tcwab-editor\n" . $body, $secret)
    const body = Buffer.from('{"sk":"tcw_abc","t":"t1","v":"b","exp":1800000300,"n":"n1"}').toString("base64url");
    const sig = createHmac("sha256", secret).update("tcwab-editor\n" + body).digest("hex");
    expect(verifyEditorToken(`${body}.${sig}`, secret, siteKey, NOW)).toMatchObject({ ok: true });
  });
});

describe("renewEditorToken", () => {
  it("issues a fresh token for the same test/variant and keeps the session start", () => {
    const first = signEditorToken(base, NOW);
    const r = renewEditorToken(first, secret, siteKey, NOW + 200);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.t).toBe(base.testId);
    expect(r.payload.v).toBe("b");
    expect(r.payload.iat).toBe(NOW);
    expect(r.payload.exp).toBe(NOW + 200 + EDITOR_TOKEN_TTL_SECONDS);
    expect(verifyEditorToken(r.token, secret, siteKey, NOW + 250).ok).toBe(true);
  });

  it("cannot revive an expired token", () => {
    const first = signEditorToken(base, NOW);
    const r = renewEditorToken(first, secret, siteKey, NOW + EDITOR_TOKEN_TTL_SECONDS + 1);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("stops renewing once the session cap is reached", () => {
    let token = signEditorToken(base, NOW);
    let now = NOW;
    // renew every 4 minutes until the cap bites
    let result = renewEditorToken(token, secret, siteKey, now);
    while (result.ok && now - NOW <= EDITOR_SESSION_MAX_SECONDS) {
      token = result.token;
      now += 240;
      result = renewEditorToken(token, secret, siteKey, now);
    }
    expect(result).toEqual({ ok: false, reason: "session_too_long" });
    expect(now - NOW).toBeGreaterThan(EDITOR_SESSION_MAX_SECONDS);
  });
});

describe("token kinds", () => {
  it("an editor token is rejected where a heatmap token is required, and vice versa", () => {
    const editor = signEditorToken(base, NOW);
    const heat = signEditorToken({ ...base, kind: "heatmap" }, NOW);
    expect(verifyEditorToken(editor, secret, siteKey, NOW, "editor").ok).toBe(true);
    expect(verifyEditorToken(editor, secret, siteKey, NOW, "heatmap")).toEqual({ ok: false, reason: "wrong_kind" });
    expect(verifyEditorToken(heat, secret, siteKey, NOW, "heatmap").ok).toBe(true);
    // The default is "editor", so a heatmap token can never write ops by accident.
    expect(verifyEditorToken(heat, secret, siteKey, NOW)).toEqual({ ok: false, reason: "wrong_kind" });
    expect(verifyEditorToken(heat, secret, siteKey, NOW, "any").ok).toBe(true);
  });

  it("renewal keeps the kind", () => {
    const heat = signEditorToken({ ...base, kind: "heatmap" }, NOW);
    const r = renewEditorToken(heat, secret, siteKey, NOW + 100);
    expect(r.ok && r.payload.k).toBe("heatmap");
  });
});
