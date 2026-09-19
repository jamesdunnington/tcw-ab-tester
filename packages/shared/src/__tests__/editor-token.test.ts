import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signEditorToken, verifyEditorToken, EDITOR_TOKEN_TTL_SECONDS } from "../editor-token.js";

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
