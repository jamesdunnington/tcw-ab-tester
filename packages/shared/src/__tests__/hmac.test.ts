import { describe, expect, it } from "vitest";
import { signRequest, verifyRequest, generateSiteCredentials, SIGNATURE_SKEW_SECONDS } from "../hmac.js";

describe("hmac signing", () => {
  const secret = "test-secret-value";
  const method = "POST";
  const path = "/wp-json/tcwab/v1/config";
  const body = JSON.stringify({ hello: "world" });

  it("round-trips: a request signed with a secret verifies with the same secret", () => {
    const signed = signRequest({ method, path, body, secret });
    const result = verifyRequest({ method, path, body, secret, ...signed });
    expect(result.ok).toBe(true);
  });

  it("rejects a signature produced with a different secret", () => {
    const signed = signRequest({ method, path, body, secret: "wrong-secret" });
    const result = verifyRequest({ method, path, body, secret, ...signed });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects if the body is tampered with after signing", () => {
    const signed = signRequest({ method, path, body, secret });
    const result = verifyRequest({ method, path, body: body + "x", secret, ...signed });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a stale timestamp outside the allowed skew", () => {
    const signed = signRequest({ method, path, body, secret });
    const now = Number(signed.timestamp) + SIGNATURE_SKEW_SECONDS + 10;
    const result = verifyRequest({ method, path, body, secret, ...signed, now });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a malformed timestamp", () => {
    const signed = signRequest({ method, path, body, secret });
    const result = verifyRequest({
      method,
      path,
      body,
      secret,
      ...signed,
      timestamp: "not-a-number",
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("generateSiteCredentials produces a unique key + secret pair each call", () => {
    const a = generateSiteCredentials();
    const b = generateSiteCredentials();
    expect(a.siteKey).not.toEqual(b.siteKey);
    expect(a.siteSecret).not.toEqual(b.siteSecret);
    expect(a.siteKey.startsWith("tcw_")).toBe(true);
    expect(a.siteSecret.length).toBeGreaterThan(32);
  });
});
