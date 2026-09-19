import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "../repo.js";
import { ACCESS_TTL_MS, CODE_TTL_MS, REFRESH_TTL_MS, createOAuthService, normalizeScopes, pkceChallenge, sha256Hex, OAuthFlowError } from "../service.js";

// RFC 7636 appendix B test vector.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function setup() {
  let t = new Date("2026-09-19T12:00:00Z").getTime();
  const repo = createMemoryRepo();
  const svc = createOAuthService(repo, () => new Date(t));
  return { repo, svc, advance: (ms: number) => (t += ms) };
}
const grant = { clientId: "c1", userId: "u1", redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: CHALLENGE, scopes: ["hub:read", "hub:draft"] };
const expectCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(OAuthFlowError);
  await expect(p).rejects.toMatchObject({ code });
};
const exchange = async (svc: ReturnType<typeof setup>["svc"]) => svc.exchangeCode({ code: await svc.issueCode(grant), clientId: "c1", codeVerifier: VERIFIER });

describe("PKCE", () => {
  it("matches the RFC 7636 test vector", () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE);
  });

  it("rejects a wrong verifier and still burns the code", async () => {
    const { svc } = setup();
    const code = await svc.issueCode(grant);
    await expectCode(svc.exchangeCode({ code, clientId: "c1", codeVerifier: "wrong-verifier-wrong-verifier-wrong-verifier-1234" }), "invalid_grant");
    await expectCode(svc.exchangeCode({ code, clientId: "c1", codeVerifier: VERIFIER }), "invalid_grant");
  });
});

describe("authorization codes", () => {
  it("issues tokens for a valid exchange", async () => {
    const { svc } = setup();
    const code = await svc.issueCode(grant);
    const tokens = await svc.exchangeCode({ code, clientId: "c1", redirectUri: grant.redirectUri, codeVerifier: VERIFIER });
    expect(tokens.scope).toBe("hub:read hub:draft");
    expect(tokens.expires_in).toBe(ACCESS_TTL_MS / 1000);
    expect(await svc.verifyAccess(tokens.access_token)).toMatchObject({ clientId: "c1", userId: "u1", scopes: ["hub:read", "hub:draft"] });
  });

  it("is single use", async () => {
    const { svc } = setup();
    const code = await svc.issueCode(grant);
    await svc.exchangeCode({ code, clientId: "c1", codeVerifier: VERIFIER });
    await expectCode(svc.exchangeCode({ code, clientId: "c1", codeVerifier: VERIFIER }), "invalid_grant");
  });

  it("expires after 10 minutes", async () => {
    const { svc, advance } = setup();
    const code = await svc.issueCode(grant);
    advance(CODE_TTL_MS + 1);
    await expectCode(svc.exchangeCode({ code, clientId: "c1", codeVerifier: VERIFIER }), "invalid_grant");
  });

  it("is bound to the client and the redirect URI", async () => {
    const { svc } = setup();
    const a = await svc.issueCode(grant);
    await expectCode(svc.exchangeCode({ code: a, clientId: "other", codeVerifier: VERIFIER }), "invalid_grant");
    const b = await svc.issueCode(grant);
    await expectCode(svc.exchangeCode({ code: b, clientId: "c1", redirectUri: "https://evil.example/cb", codeVerifier: VERIFIER }), "invalid_grant");
  });

  it("stores only hashes", async () => {
    const { svc, repo } = setup();
    const code = await svc.issueCode(grant);
    expect(await repo.peekCode(code)).toBeUndefined();
    expect(await repo.peekCode(sha256Hex(code))).toBeDefined();
    const tokens = await svc.exchangeCode({ code, clientId: "c1", codeVerifier: VERIFIER });
    expect(await repo.findToken(tokens.access_token)).toBeUndefined();
    expect(await repo.findToken(sha256Hex(tokens.access_token))).toBeDefined();
  });
});

describe("access tokens", () => {
  it("expire after an hour and cannot be used as refresh tokens", async () => {
    const { svc, advance } = setup();
    const t = await exchange(svc);
    await expectCode(svc.refresh({ refreshToken: t.access_token, clientId: "c1" }), "invalid_grant");
    advance(ACCESS_TTL_MS + 1);
    expect(await svc.verifyAccess(t.access_token)).toBeNull();
  });

  it("a refresh token is not accepted as an access token", async () => {
    const { svc } = setup();
    const t = await exchange(svc);
    expect(await svc.verifyAccess(t.refresh_token)).toBeNull();
  });

  it("revoking one token ends the whole grant", async () => {
    const { svc } = setup();
    const t = await exchange(svc);
    await svc.revoke(t.refresh_token);
    expect(await svc.verifyAccess(t.access_token)).toBeNull();
    await expectCode(svc.refresh({ refreshToken: t.refresh_token, clientId: "c1" }), "invalid_grant");
  });
});

describe("refresh rotation", () => {
  it("issues a new pair and retires the old refresh token", async () => {
    const { svc } = setup();
    const first = await exchange(svc);
    const second = await svc.refresh({ refreshToken: first.refresh_token, clientId: "c1" });
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await svc.verifyAccess(second.access_token)).not.toBeNull();
  });

  it("revokes the whole family when a used refresh token is replayed", async () => {
    const { svc } = setup();
    const first = await exchange(svc);
    const second = await svc.refresh({ refreshToken: first.refresh_token, clientId: "c1" });
    await expectCode(svc.refresh({ refreshToken: first.refresh_token, clientId: "c1" }), "invalid_grant");
    expect(await svc.verifyAccess(second.access_token)).toBeNull();
    await expectCode(svc.refresh({ refreshToken: second.refresh_token, clientId: "c1" }), "invalid_grant");
  });

  it("cannot widen scopes, and expires after 30 days", async () => {
    const { svc, advance } = setup();
    const t = await exchange(svc);
    await expectCode(svc.refresh({ refreshToken: t.refresh_token, clientId: "c1", scopes: ["hub:live"] }), "invalid_scope");
    advance(REFRESH_TTL_MS + 1);
    await expectCode(svc.refresh({ refreshToken: t.refresh_token, clientId: "c1" }), "invalid_grant");
  });

  it("is bound to the client", async () => {
    const { svc } = setup();
    const t = await exchange(svc);
    await expectCode(svc.refresh({ refreshToken: t.refresh_token, clientId: "other" }), "invalid_grant");
  });
});

describe("normalizeScopes", () => {
  it("always includes read and never grants live unless both asked and approved", () => {
    expect(normalizeScopes(undefined, ["hub:read", "hub:draft"])).toEqual(["hub:read", "hub:draft"]);
    expect(normalizeScopes(["hub:live"], ["hub:read", "hub:draft"])).toEqual(["hub:read"]);
    expect(normalizeScopes(["hub:read", "hub:draft", "hub:live"], ["hub:read", "hub:live"])).toEqual(["hub:read", "hub:live"]);
    expect(normalizeScopes(["bogus"], ["hub:read"])).toEqual(["hub:read"]);
  });
});
