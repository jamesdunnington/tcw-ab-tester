import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { OAuthRepo } from "./repo.js";

export const SCOPES = ["hub:read", "hub:draft", "hub:live"] as const;
export type Scope = (typeof SCOPES)[number];

export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OAuthFailure = "invalid_grant" | "invalid_scope";

export class OAuthFlowError extends Error {
  constructor(public readonly code: OAuthFailure, message: string) {
    super(message);
  }
}

export interface IssuedTokens {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface VerifiedToken {
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: number; // epoch seconds
  resource?: string;
}

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");
const newSecret = (): string => randomBytes(32).toString("base64url");

/** S256 PKCE: BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Keeps only known scopes, always includes read, and never grants more than was asked for. */
export function normalizeScopes(requested: string[] | undefined, granted: string[]): Scope[] {
  const asked = requested && requested.length ? requested : ["hub:read", "hub:draft"];
  const out = new Set<Scope>(["hub:read"]);
  for (const s of SCOPES) if (asked.includes(s) && granted.includes(s)) out.add(s);
  return SCOPES.filter((s) => out.has(s));
}

/**
 * Authorization codes and tokens. Everything secret is stored only as a SHA-256 hash. The clock is
 * injectable so expiry can be tested without waiting.
 */
export function createOAuthService(repo: OAuthRepo, now: () => Date = () => new Date()) {
  async function issuePair(base: { clientId: string; userId: string; scopes: string[]; resource: string | null; familyId: string }): Promise<IssuedTokens> {
    const issuedAt = now().getTime();
    const access = newSecret();
    const refresh = newSecret();
    await repo.saveToken({ id: randomUUID(), tokenHash: sha256Hex(access), kind: "access", ...base, expiresAt: new Date(issuedAt + ACCESS_TTL_MS), usedAt: null, revokedAt: null });
    await repo.saveToken({ id: randomUUID(), tokenHash: sha256Hex(refresh), kind: "refresh", ...base, expiresAt: new Date(issuedAt + REFRESH_TTL_MS), usedAt: null, revokedAt: null });
    return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: base.scopes.join(" ") };
  }

  return {
    async issueCode(input: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scopes: string[]; resource?: string }): Promise<string> {
      const code = newSecret();
      await repo.saveCode({
        codeHash: sha256Hex(code),
        clientId: input.clientId,
        userId: input.userId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        scopes: input.scopes,
        resource: input.resource ?? null,
        expiresAt: new Date(now().getTime() + CODE_TTL_MS),
      });
      return code;
    },

    /** The stored challenge for the SDK's own PKCE check. Does not consume the code. */
    async challengeFor(code: string, clientId: string): Promise<string> {
      const rec = await repo.peekCode(sha256Hex(code));
      if (!rec || rec.expiresAt <= now() || rec.clientId !== clientId) throw new OAuthFlowError("invalid_grant", "Invalid or expired authorization code");
      return rec.codeChallenge;
    },

    /** Single use: the code is removed before any check, so even a failed exchange burns it. */
    async exchangeCode(input: { code: string; clientId: string; redirectUri?: string; codeVerifier: string }): Promise<IssuedTokens> {
      const rec = await repo.consumeCode(sha256Hex(input.code));
      if (!rec || rec.expiresAt <= now()) throw new OAuthFlowError("invalid_grant", "Invalid or expired authorization code");
      if (rec.clientId !== input.clientId) throw new OAuthFlowError("invalid_grant", "Code was issued to a different client");
      if (input.redirectUri !== undefined && input.redirectUri !== rec.redirectUri) throw new OAuthFlowError("invalid_grant", "redirect_uri does not match the authorization request");
      if (!safeEqual(pkceChallenge(input.codeVerifier), rec.codeChallenge)) throw new OAuthFlowError("invalid_grant", "code_verifier does not match the challenge");
      return issuePair({ clientId: rec.clientId, userId: rec.userId, scopes: rec.scopes, resource: rec.resource, familyId: randomUUID() });
    },

    /** Rotation: each refresh token works once. Presenting a used one means it leaked, so the whole family is revoked. */
    async refresh(input: { refreshToken: string; clientId: string; scopes?: string[] }): Promise<IssuedTokens> {
      const rec = await repo.findToken(sha256Hex(input.refreshToken));
      if (!rec || rec.kind !== "refresh" || rec.clientId !== input.clientId) throw new OAuthFlowError("invalid_grant", "Invalid refresh token");
      if (rec.revokedAt) throw new OAuthFlowError("invalid_grant", "Refresh token was revoked");
      if (rec.usedAt) {
        await repo.revokeFamily(rec.familyId, now());
        throw new OAuthFlowError("invalid_grant", "Refresh token was already used");
      }
      if (rec.expiresAt <= now()) throw new OAuthFlowError("invalid_grant", "Refresh token expired");
      if (input.scopes && input.scopes.some((s) => !rec.scopes.includes(s))) throw new OAuthFlowError("invalid_scope", "Cannot widen scopes on refresh");
      if (!(await repo.markTokenUsed(rec.id, now()))) {
        await repo.revokeFamily(rec.familyId, now());
        throw new OAuthFlowError("invalid_grant", "Refresh token was already used");
      }
      return issuePair({ clientId: rec.clientId, userId: rec.userId, scopes: input.scopes?.length ? input.scopes : rec.scopes, resource: rec.resource, familyId: rec.familyId });
    },

    async verifyAccess(token: string): Promise<VerifiedToken | null> {
      const rec = await repo.findToken(sha256Hex(token));
      if (!rec || rec.kind !== "access" || rec.revokedAt || rec.expiresAt <= now()) return null;
      return { clientId: rec.clientId, userId: rec.userId, scopes: rec.scopes, expiresAt: Math.floor(rec.expiresAt.getTime() / 1000), ...(rec.resource ? { resource: rec.resource } : {}) };
    },

    /** Revoking either token of a pair ends the whole grant. */
    async revoke(token: string): Promise<void> {
      const rec = await repo.findToken(sha256Hex(token));
      if (rec) await repo.revokeFamily(rec.familyId, now());
    },
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
