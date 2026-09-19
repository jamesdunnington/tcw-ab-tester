import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { eq } from "drizzle-orm";
import { auditLog, users, type Database } from "@tcw/db";
import { verifyPassword } from "@tcw/core";
import type { OAuthRepo } from "./repo.js";
import { SCOPES, normalizeScopes, type OAuthService } from "./service.js";
import { consentPage, messagePage } from "./pages.js";
import { verifyPending } from "./state.js";

// Compared against when the email is unknown, so a wrong email and a wrong password take the same time.
const DUMMY_HASH = "scrypt:00000000000000000000000000000000:" + "0".repeat(128);

function redirectTo(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.toString();
}

/** The form on the login page posts here: checks the admin's credentials, then issues the authorization code. */
export function consentRouter(deps: { db: Database; service: OAuthService; repo: OAuthRepo; sessionSecret: string }): Router {
  const router = Router();
  router.use(express.urlencoded({ extended: false }));
  router.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      skipSuccessfulRequests: true, // only failed logins count against the limit
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).type("html").send(messagePage("Too many attempts", "Wait 15 minutes and start again from Claude."));
      },
    }),
  );

  router.post("/", async (req, res) => {
    res.set({ "cache-control": "no-store", "x-frame-options": "DENY" });
    const body = req.body as Record<string, unknown>;
    const pendingToken = typeof body.pending === "string" ? body.pending : "";
    const pending = verifyPending(pendingToken, deps.sessionSecret);
    if (!pending) return void res.status(400).type("html").send(messagePage("This request expired", "Go back to Claude and connect again."));

    if (body.decision === "deny") {
      return void res.redirect(302, redirectTo(pending.redirectUri, { error: "access_denied", error_description: "The user denied the request", state: pending.state }));
    }

    const client = await deps.repo.getClient(pending.clientId);
    if (!client) return void res.status(400).type("html").send(messagePage("Unknown client", "Go back to Claude and connect again."));
    const clientName = String(client.metadata.client_name ?? "An MCP client");
    const redirectHost = new URL(pending.redirectUri).host;

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const [user] = email ? await deps.db.select().from(users).where(eq(users.email, email)).limit(1) : [];
    const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH) && !!user;

    if (!valid) {
      await deps.db.insert(auditLog).values({ actor: `mcp:${clientName}`, action: "mcp.login_failed", target: pending.clientId, meta: { email, ip: req.ip } });
      return void res.status(401).type("html").send(consentPage({ clientName, redirectHost, pending: pendingToken, requested: pending.scopes, error: "Wrong email or password.", email }));
    }

    const rawScope = body.scope;
    const ticked = Array.isArray(rawScope) ? rawScope.map(String) : typeof rawScope === "string" ? [rawScope] : [];
    // The client's own request caps what can be granted; when it asked for nothing, the user's ticks decide.
    const scopes = normalizeScopes(pending.scopes.length ? pending.scopes : [...SCOPES], ticked);
    const code = await deps.service.issueCode({ clientId: pending.clientId, userId: user.id, redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge, scopes, resource: pending.resource });
    await deps.db.insert(auditLog).values({ actor: user.email, action: "mcp.authorized", target: pending.clientId, meta: { client: clientName, scopes } });
    res.redirect(302, redirectTo(pending.redirectUri, { code, state: pending.state }));
  });

  return router;
}
