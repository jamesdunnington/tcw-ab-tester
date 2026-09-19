import express, { type Express, type Request, type Response } from "express";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Database } from "@tcw/db";
import { createPgRepo, type OAuthRepo } from "./oauth/repo.js";
import { SCOPES, createOAuthService } from "./oauth/service.js";
import { createProvider } from "./oauth/provider.js";
import { consentRouter } from "./oauth/consent-route.js";
import { createServer } from "./server.js";

export interface AppDeps {
  db: Database;
  publicUrl: string;
  sessionSecret: string;
  box: { encrypt(s: string): string; decrypt(s: string): string };
  repo?: OAuthRepo;
}

/** The connector: OAuth authorization server (Express handlers from the MCP SDK) plus the /mcp resource. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.set("trust proxy", 1); // behind Caddy: correct client IPs for rate limiting and audit
  app.disable("x-powered-by");

  const repo = deps.repo ?? createPgRepo(deps.db, deps.box);
  const service = createOAuthService(repo);
  const provider = createProvider({ service, repo, sessionSecret: deps.sessionSecret });
  const issuerUrl = new URL(deps.publicUrl);
  const resourceServerUrl = new URL("/mcp", issuerUrl);

  app.get("/healthz", (_req, res) => void res.json({ ok: true }));

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      baseUrl: issuerUrl,
      scopesSupported: [...SCOPES],
      resourceName: "TCW A/B Tester",
      resourceServerUrl,
      // The SDK also rate-limits /authorize, /token and /revoke; registration is the abuse-prone one, so it gets a tighter cap.
      clientRegistrationOptions: { clientSecretExpirySeconds: 0, rateLimit: { windowMs: 60 * 60 * 1000, limit: 30 } },
    }),
  );
  app.use("/oauth/consent", consentRouter({ db: deps.db, service, repo, sessionSecret: deps.sessionSecret }));

  const bearer = requireBearerAuth({ verifier: provider, requiredScopes: ["hub:read"], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl) });

  // Stateless Streamable HTTP: a fresh server and transport per request, so nothing is held between calls.
  app.post("/mcp", express.json({ limit: "1mb" }), bearer, async (req: Request, res: Response) => {
    const server = createServer(req.auth?.scopes ?? []);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });

  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).set("allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST." }, id: null });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}
