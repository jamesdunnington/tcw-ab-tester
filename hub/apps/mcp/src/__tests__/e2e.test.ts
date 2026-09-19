import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// env.ts validates process.env when first imported, so it must be set before any app module loads.
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
    SECRET_ENCRYPTION_KEY: "ab".repeat(32),
    SESSION_SECRET: "s".repeat(40),
    MCP_PUBLIC_URL: "http://127.0.0.1:1",
    HUB_PUBLIC_URL: "http://127.0.0.1:2",
    ALLOW_PRIVATE_SITE_FETCH: "1",
  });
});

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as schema from "@tcw/db";
import { configureCore, encryptSecret, decryptSecret, hashPassword } from "@tcw/core";
import { createApp } from "../app.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "..", "..", "api", "drizzle");
const VERIFIER = randomBytes(32).toString("base64url");
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const CALLBACK = "http://127.0.0.1:9/callback";

let wp: Server;
let hub: Server;
let base = "";
let pg: PGlite;
let db: any;
const ids: { user: string; site: string; test: string; page: string } = { user: "", site: "", test: "", page: "" };

const PAGE_HTML = `<html><head><title>Home</title></head><body><main id="main"><h1 id="hero-title">Grow faster</h1><p>Body copy</p><a id="cta" class="btn" href="/buy">Buy now</a></main><script>alert(1)</script></body></html>`;

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function authorize(opts: { scopes: string[]; password?: string; clientId: string; challenge?: string }) {
  const page = await fetch(`${base}/authorize?${new URLSearchParams({ client_id: opts.clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: opts.challenge ?? CHALLENGE, code_challenge_method: "S256", state: "st8", scope: "hub:read hub:draft hub:live" })}`);
  const html = await page.text();
  const pending = /name="pending" value="([^"]+)"/.exec(html)?.[1] ?? "";
  const body = new URLSearchParams({ pending, email: "admin@test.dev", password: opts.password ?? "correct horse battery", decision: "approve" });
  for (const s of opts.scopes) body.append("scope", s);
  const res = await fetch(`${base}/oauth/consent`, { method: "POST", body, redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" } });
  return { page, html, res, pending };
}

async function tokenFor(clientId: string, scopes: string[]) {
  const { res } = await authorize({ scopes, clientId });
  const code = new URL(res.headers.get("location") as string).searchParams.get("code") as string;
  const tokenRes = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK }),
  });
  const tokens = (await tokenRes.clone().json()) as Record<string, string>;
  if (!tokenRes.ok) throw new Error("token exchange failed: " + JSON.stringify(tokens));
  return { code, tokenRes, tokens };
}

async function connect(accessToken: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return client;
}

let finalizeBody: any = null;
const jsonOf = (r: any) => JSON.parse(r.content[0].text);

beforeAll(async () => {
  // A stand-in for the WordPress plugin: just enough of its signed REST routes and a public page.
  wp = createServer((req, res) => {
    const url = req.url ?? "";
    const send = (o: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (url.startsWith("/wp-json/tcwab/v1/posts/12")) return send({ id: 12, type: "page", title: "Home", permalink: `http://127.0.0.1:${(wp.address() as AddressInfo).port}/home/`, wordCount: 120 });
    if (url.startsWith("/wp-json/tcwab/v1/posts?")) return send({ posts: [{ id: 12, type: "page", status: "publish", title: "Home", permalink: "x" }] });
    if (url.startsWith("/wp-json/tcwab/v1/config")) return send({ ok: true });
    if (url.startsWith("/wp-json/tcwab/v1/finalize")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        finalizeBody = JSON.parse(raw);
        send({ promoted: false, revisionSaved: false, deleted: [], retired: [], errors: [], permanentRule: true });
      });
      return;
    }
    if (url === "/home/") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE_HTML);
    res.writeHead(404).end();
  });
  const wpPort = await listen(wp);

  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  configureCore({ db, secretKeyHex: process.env.SECRET_ENCRYPTION_KEY as string });

  const [user] = await db.insert(schema.users).values({ email: "admin@test.dev", passwordHash: hashPassword("correct horse battery") }).returning();
  const [site] = await db.insert(schema.sites).values({ domain: `http://127.0.0.1:${wpPort}`, displayName: "Test site", siteKey: "sk_test", secretEncrypted: encryptSecret("shh") }).returning();
  const [test] = await db.insert(schema.tests).values({ siteId: site.id, name: "Seeded", type: "page", status: "running", wpPostId: 12, wpPermalink: `http://127.0.0.1:${wpPort}/home/`, startedAt: new Date(Date.now() - 3 * 86_400_000) }).returning();
  const [a, b] = await db.insert(schema.variants).values([{ testId: test.id, key: "a", label: "A (original)", isControl: true, trafficWeight: 50 }, { testId: test.id, key: "b", label: "B (variant)", isControl: false, trafficWeight: 50 }]).returning();
  Object.assign(ids, { user: user.id, site: site.id, test: test.id });

  // 10 sessions on A (2 clicked), 10 on B (5 clicked); B engages longer and scrolls deeper.
  const rows = [] as any[];
  for (let i = 0; i < 10; i++) {
    rows.push({ testId: test.id, variantId: a.id, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: i < 6 ? "desktop" : "mobile", activeMs: 10_000 + i * 1000, maxScrollPct: "40", clicked: i < 2, rageClicks: 0 });
    rows.push({ testId: test.id, variantId: b.id, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: i < 6 ? "desktop" : "mobile", activeMs: 20_000 + i * 1000, maxScrollPct: "80", clicked: i < 5, rageClicks: i === 0 ? 2 : 0 });
  }
  await db.insert(schema.pageviews).values(rows);
  await db.insert(schema.events).values([
    { siteId: site.id, testId: test.id, variantId: b.id, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: "desktop", type: "click", url: "/", data: { goal: "buy" }, ts: new Date() },
    { siteId: site.id, testId: test.id, variantId: b.id, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: "desktop", type: "hover", url: "/", data: { goal: "buy", durationMs: 1200 }, ts: new Date() },
  ]);

  hub = createServer();
  const hubPort = await listen(hub);
  base = `http://127.0.0.1:${hubPort}`;
  hub.removeAllListeners("request");
  hub.on("request", createApp({ db, publicUrl: base, sessionSecret: process.env.SESSION_SECRET as string, box: { encrypt: encryptSecret, decrypt: decryptSecret } }));
}, 60_000);

afterAll(async () => {
  wp?.close();
  hub?.close();
  await pg?.close();
});

describe("OAuth flow", () => {
  let clientId = "";

  it("publishes discovery metadata", async () => {
    const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(meta.code_challenge_methods_supported).toContain("S256");
    expect(meta.scopes_supported).toEqual(["hub:read", "hub:draft", "hub:live"]);
    const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(resource.authorization_servers).toBeDefined();
  });

  it("registers only Claude or loopback redirect URIs", async () => {
    const bad = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"], token_endpoint_auth_method: "none", client_name: "Evil" }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", client_name: "E2E Claude", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
    expect(ok.status).toBe(201);
    clientId = (await ok.json()).client_id;
  });

  it("shows a consent page with the live permission unticked by default", async () => {
    const { page, html } = await authorize({ scopes: [], clientId, password: "x" });
    expect(page.status).toBe(200);
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(html).toContain("Connect E2E Claude");
    expect(html).toMatch(/value="hub:live"\s*>/);
    expect(html).not.toMatch(/value="hub:live" checked/);
  });

  it("rejects a wrong password, logs it, and does not issue a code", async () => {
    const { res } = await authorize({ scopes: ["hub:read"], clientId, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "mcp.login_failed"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rejects a tampered pending request", async () => {
    const res = await fetch(`${base}/oauth/consent`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ pending: "e30.bad", email: "admin@test.dev", password: "correct horse battery", decision: "approve" }) });
    expect(res.status).toBe(400);
  });

  it("issues single-use codes that need the right PKCE verifier", async () => {
    const { res } = await authorize({ scopes: ["hub:read"], clientId });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") as string);
    expect(location.searchParams.get("state")).toBe("st8");
    const code = location.searchParams.get("code") as string;
    const exchange = (verifier: string) => fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK }) });

    expect((await exchange("not-the-verifier-not-the-verifier-not-the-verifier")).status).toBe(400);
    expect((await exchange(VERIFIER)).status).toBe(400); // the failed attempt already burned the code
  });

  it("rotates refresh tokens and revokes the family on replay", async () => {
    const { tokens } = await tokenFor(clientId, ["hub:read"]);
    const refresh = (t: string) => fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t, client_id: clientId }) });
    const first = await refresh(tokens.refresh_token);
    expect(first.status).toBe(200);
    const rotated = await first.json();
    expect((await refresh(tokens.refresh_token)).status).toBe(400); // replay
    expect((await refresh(rotated.refresh_token)).status).toBe(400); // family revoked
    const denied = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${rotated.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(denied.status).toBe(401);
  });

  it("stores no plaintext tokens", async () => {
    const { tokens } = await tokenFor(clientId, ["hub:read"]);
    const rows = await db.select().from(schema.oauthTokens);
    expect(rows.some((r: any) => r.tokenHash === tokens.access_token || r.tokenHash === tokens.refresh_token)).toBe(false);
  });

  it("requires a bearer token on /mcp", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("resource_metadata");
  });

  describe("tools", () => {
    it("offers only read tools to a read-only grant", async () => {
      const { tokens } = await tokenFor(clientId, ["hub:read"]);
      const client = await connect(tokens.access_token);
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["list_sites", "list_tests", "get_test", "get_results", "get_analytics", "find_posts", "inspect_page"]));
      expect(names).not.toContain("create_element_test");
      expect(names).not.toContain("apply_winner");
      await client.close();
    });

    it("lets the AI read analytics: distributions, devices, daily trend and goals", async () => {
      const { tokens } = await tokenFor(clientId, ["hub:read"]);
      const client = await connect(tokens.access_token);
      const analytics = jsonOf(await client.callTool({ name: "get_analytics", arguments: { testId: ids.test } }));
      const a = analytics.variants.find((v: any) => v.key === "a");
      const b = analytics.variants.find((v: any) => v.key === "b");
      expect(a.sessions).toBe(10);
      expect(a.conversionRatePct).toBe(20);
      expect(b.conversionRatePct).toBe(50);
      expect(b.avgScrollDepthPct).toBe(80);
      expect(b.scrollDepthDistributionPct["75-100"]).toBe(100);
      expect(b.medianActiveSeconds).toBeGreaterThan(a.medianActiveSeconds);
      expect(b.rageClicks).toBe(2);
      expect(analytics.byDevice.filter((d: any) => d.key === "b").map((d: any) => d.device).sort()).toEqual(["desktop", "mobile"]);
      expect(analytics.daily.length).toBeGreaterThan(0);
      expect(analytics.goals).toEqual(expect.arrayContaining([expect.objectContaining({ goal: "buy", kind: "click", key: "b" }), expect.objectContaining({ goal: "buy", kind: "hover", avgHoverSeconds: 1.2 })]));

      const results = jsonOf(await client.callTool({ name: "get_results", arguments: { testId: ids.test } }));
      expect(results.results).toHaveLength(2);
      expect(results.stats).toContain("No statistics computed yet");
      await client.close();
    });

    it("inspects a page and verifies selectors, never returning script content", async () => {
      const { tokens } = await tokenFor(clientId, ["hub:read"]);
      const client = await connect(tokens.access_token);
      const out = jsonOf(await client.callTool({ name: "inspect_page", arguments: { siteId: ids.site, wpPostId: 12, checkSelectors: ["#cta", ".nope"] } }));
      expect(out.outline.find((n: any) => n.selector === "#cta")).toMatchObject({ tag: "a", text: "Buy now", href: "/buy" });
      expect(out.outline.find((n: any) => n.selector === "#hero-title")).toBeDefined();
      expect(JSON.stringify(out)).not.toContain("alert(1)");
      expect(out.selectorChecks).toEqual([expect.objectContaining({ selector: "#cta", matches: 1 }), expect.objectContaining({ selector: ".nope", matches: 0 })]);
      const found = jsonOf(await client.callTool({ name: "find_posts", arguments: { siteId: ids.site, query: "home" } }));
      expect(found.posts[0].id).toBe(12);
      await client.close();
    });

    it("drafts an element test end to end and audit-logs it with the client name", async () => {
      const { tokens } = await tokenFor(clientId, ["hub:read", "hub:draft"]);
      const client = await connect(tokens.access_token);
      const created = jsonOf(await client.callTool({ name: "create_element_test", arguments: { siteId: ids.site, wpPostId: 12 } }));
      expect(created.status).toBe("draft");

      const bad = await client.callTool({ name: "set_variant_ops", arguments: { testId: created.testId, ops: [{ op: "style", selector: "#cta", styles: { "background-image": "url(javascript:alert(1))" } }] } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
      expect((bad as any).isError).toBe(true);

      const saved = jsonOf(await client.callTool({ name: "set_variant_ops", arguments: { testId: created.testId, variantKey: "b", ops: [{ op: "text", selector: "#cta", value: "Start free" }, { op: "goal", selector: "#cta", name: "buy" }] } }));
      expect(saved).toMatchObject({ saved: true, edits: 1, goals: 1 });
      const link = jsonOf(await client.callTool({ name: "get_editor_link", arguments: { testId: created.testId } }));
      expect(new URL(link.url).searchParams.get("tcwab_editor")).toBeTruthy();

      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "mcp.variant_ops_set"));
      expect(audit[0].actor).toBe("mcp:E2E Claude:admin@test.dev");
      await client.close();
    });

    it("refuses to edit a running test and hides live tools without the live grant", async () => {
      const { tokens } = await tokenFor(clientId, ["hub:read", "hub:draft"]);
      const client = await connect(tokens.access_token);
      const res: any = await client.callTool({ name: "set_variant_ops", arguments: { testId: ids.test, ops: [{ op: "hide", selector: "#cta" }] } });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("test_is_not_a_draft");
      expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("start_test");
      await client.close();
    });

    it("gates going live behind the live grant and confirm: true", async () => {
      const { tokens } = await tokenFor(clientId, ["hub:read", "hub:draft", "hub:live"]);
      const client = await connect(tokens.access_token);
      const tools = (await client.listTools()).tools;
      expect(tools.find((t) => t.name === "apply_winner")?.annotations?.destructiveHint).toBe(true);

      const unconfirmed: any = await client.callTool({ name: "start_test", arguments: { testId: ids.test } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
      expect(unconfirmed.isError).toBe(true);

      const drafts = jsonOf(await client.callTool({ name: "list_tests", arguments: { status: "draft" } }));
      const draft = drafts.find((t: any) => t.type === "element");
      const started = jsonOf(await client.callTool({ name: "start_test", arguments: { testId: draft.id, confirm: true } }));
      expect(started.status).toBe("running");
      const stopped = jsonOf(await client.callTool({ name: "stop_test", arguments: { testId: draft.id, confirm: true } }));
      expect(stopped.status).toBe("inconclusive");

      const override: any = await client.callTool({ name: "apply_winner", arguments: { testId: draft.id, chosenVariantKey: "zzz", deleteRedundant: false, confirm: true } });
      expect(override.isError).toBe(true);
      expect(override.content[0].text).toContain("unknown_variant");

      // Winner flow for an element test: the winning edits become a permanent rule, goals stripped, nothing to delete.
      const applied = jsonOf(await client.callTool({ name: "apply_winner", arguments: { testId: draft.id, chosenVariantKey: "b", deleteRedundant: true, confirm: true } }));
      expect(applied.decided).toBe(true);
      expect(finalizeBody.chosenKey).toBe("b");
      expect(finalizeBody.deleteRedundant).toBe(false); // element tests have no copy to delete
      expect(finalizeBody.permanentOps).toEqual([{ op: "text", selector: "#cta", value: "Start free" }]);
      const [row] = await db.select().from(schema.tests).where(eq(schema.tests.id, draft.id));
      expect(row.status).toBe("archived");
      const decided = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "test.decided"));
      expect(decided[0].actor).toBe("mcp:E2E Claude:admin@test.dev");
      await client.close();
    });
  });
});
