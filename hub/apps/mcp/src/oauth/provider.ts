import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthRepo } from "./repo.js";
import { OAuthFlowError, SCOPES, type OAuthService } from "./service.js";
import { consentPage } from "./pages.js";
import { signPending } from "./state.js";

const PENDING_TTL_MS = 10 * 60 * 1000;
/** Hosts a browser-based Claude client redirects back to. */
const ALLOWED_REDIRECT_HOSTS = new Set(["claude.ai", "claude.com", "www.claude.ai"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Dynamic registration is open by design, so anyone could register a client with a phishing redirect.
 * Only Claude's callback hosts and loopback (Claude Code, the MCP Inspector) are accepted.
 */
export function isAllowedRedirect(uri: string, extraHosts: string[] = []): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" && (ALLOWED_REDIRECT_HOSTS.has(u.hostname) || extraHosts.includes(u.hostname))) return true;
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

export function createProvider(deps: { service: OAuthService; repo: OAuthRepo; sessionSecret: string; extraRedirectHosts?: string[] }): OAuthServerProvider {
  const { service, repo } = deps;

  const clientsStore: OAuthRegisteredClientsStore = {
    async getClient(clientId) {
      const rec = await repo.getClient(clientId);
      if (!rec) return undefined;
      return { ...rec.metadata, client_id: rec.clientId, ...(rec.clientSecret ? { client_secret: rec.clientSecret } : {}) } as OAuthClientInformationFull;
    },
    async registerClient(client) {
      const info = client as OAuthClientInformationFull;
      if (!info.redirect_uris.every((u) => isAllowedRedirect(String(u), deps.extraRedirectHosts))) {
        throw new InvalidClientMetadataError("redirect_uris must be Claude's callback URL or a loopback address");
      }
      const clientId = info.client_id ?? randomUUID();
      const { client_secret, client_id: _id, ...metadata } = info;
      await repo.saveClient({ clientId, clientSecret: client_secret ?? null, metadata: metadata as Record<string, unknown> });
      return { ...info, client_id: clientId };
    },
  };

  const mapErrors = <T>(p: Promise<T>): Promise<T> =>
    p.catch((err) => {
      if (err instanceof OAuthFlowError) throw err.code === "invalid_scope" ? new InvalidScopeError(err.message) : new InvalidGrantError(err.message);
      throw err instanceof Error ? new ServerError("Internal Server Error") : err;
    });

  return {
    clientsStore,
    // PKCE is verified once, inside service.exchangeCode, after the code is consumed. That way a wrong
    // verifier burns the code, and the SDK hands the verifier to exchangeAuthorizationCode below.
    skipLocalPkceValidation: true,

    // Shows the login + consent page. The request is carried in a signed hidden field; nothing is stored until approval.
    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
      const requested = (params.scopes ?? []).filter((s) => (SCOPES as readonly string[]).includes(s));
      const pending = signPending(
        {
          clientId: client.client_id,
          redirectUri: params.redirectUri,
          codeChallenge: params.codeChallenge,
          scopes: requested,
          state: params.state,
          resource: params.resource?.href,
          exp: Date.now() + PENDING_TTL_MS,
        },
        deps.sessionSecret,
      );
      res
        .status(200)
        .set({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'" })
        .send(consentPage({ clientName: client.client_name ?? "An MCP client", redirectHost: new URL(params.redirectUri).host, pending, requested }));
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      return mapErrors(service.challengeFor(authorizationCode, client.client_id));
    },

    async exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri): Promise<OAuthTokens> {
      if (!codeVerifier) throw new InvalidGrantError("code_verifier is required");
      return mapErrors(service.exchangeCode({ code: authorizationCode, clientId: client.client_id, redirectUri, codeVerifier }));
    },

    async exchangeRefreshToken(client, refreshToken, scopes): Promise<OAuthTokens> {
      return mapErrors(service.refresh({ refreshToken, clientId: client.client_id, scopes }));
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const v = await service.verifyAccess(token);
      if (!v) throw new InvalidTokenError("Invalid or expired access token"); // 401, so the client knows to refresh
      return { token, clientId: v.clientId, scopes: v.scopes, expiresAt: v.expiresAt, extra: { userId: v.userId } };
    },

    async revokeToken(_client, request: OAuthTokenRevocationRequest): Promise<void> {
      await service.revoke(request.token);
    },
  };
}
