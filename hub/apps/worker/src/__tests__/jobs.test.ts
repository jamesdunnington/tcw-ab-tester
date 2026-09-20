import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@tcw/db";
import type { Database } from "@tcw/db";
import { buildWinnerEmail, notifyWinnerFound, type MailTransport } from "../notify.js";
import { cutoff, purgeOldData } from "../retention.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "api", "drizzle");
const DAY = 86_400_000;
const NOW = new Date("2026-09-20T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

let pg: PGlite;
let db: any;
let ids = { site: "", test: "", a: "", b: "" };

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.insert(schema.users).values({ email: "owner@example.com", passwordHash: "x" });
  const [site] = await db.insert(schema.sites).values({ domain: "https://s.example", displayName: "S", siteKey: "k", secretEncrypted: "x" }).returning();
  const [test] = await db.insert(schema.tests).values({ siteId: site.id, name: "Hero <b>test</b>", status: "winner_found", wpPostId: 1, wpPermalink: "https://s.example/", startedAt: ago(10) }).returning();
  const [a, b] = await db.insert(schema.variants).values([
    { testId: test.id, key: "a", label: "A (original)", isControl: true, trafficWeight: 50 },
    { testId: test.id, key: "b", label: "B (variant)", isControl: false, trafficWeight: 50 },
  ]).returning();
  ids = { site: site.id, test: test.id, a: a.id, b: b.id };
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

const decision = { winnerKey: "b", variants: [{ key: "b", pBest: 0.972, lift: { estimate: 0.123 } }] } as any;
const config = { from: "TCW <ab@x.dev>", recipients: "", hubUrl: "https://ab.example.com/" };
const fakeTransport = () => {
  const sent: any[] = [];
  const t: MailTransport = { sendMail: async (m) => void sent.push(m) };
  return { t, sent };
};
const resetClaim = () => db.update(schema.tests).set({ winnerNotifiedAt: null }).where(eq(schema.tests.id, ids.test));

describe("buildWinnerEmail", () => {
  it("names the winner with its numbers and links to the test", () => {
    const m = buildWinnerEmail({ testName: "Hero", winnerLabel: "B (variant)", pBest: 0.972, lift: 0.123, url: "https://ab/tests/1" });
    expect(m.subject).toBe("A/B test has a winner: Hero");
    expect(m.text).toContain("97.2% chance it is best");
    expect(m.text).toContain("+12.3% engagement vs the original");
    expect(m.text).toContain("https://ab/tests/1");
    expect(m.text).toContain("Nothing changes on the site until you decide");
  });

  it("omits numbers it does not have, and escapes HTML from a WordPress title", () => {
    const m = buildWinnerEmail({ testName: `<img src=x onerror=alert(1)>`, winnerLabel: `A&B`, pBest: null, lift: null, url: `https://ab/"><script>` });
    expect(m.text).not.toContain("chance");
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("A&amp;B");
  });
});

describe("notifyWinnerFound", () => {
  it("does nothing, and claims nothing, when email is not configured", async () => {
    expect(await notifyWinnerFound({ db, transport: null, config }, ids.test, decision)).toBe("not_configured");
    const [t] = await db.select().from(schema.tests).where(eq(schema.tests.id, ids.test));
    expect(t.winnerNotifiedAt).toBeNull();
  });

  it("sends once to every hub user when no recipients are set, and never twice", async () => {
    const { t, sent } = fakeTransport();
    expect(await notifyWinnerFound({ db, transport: t, config }, ids.test, decision)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("owner@example.com");
    expect(sent[0].text).toContain("https://ab.example.com/tests/" + ids.test);
    expect(sent[0].text).toContain("B (variant)");
    expect(await notifyWinnerFound({ db, transport: t, config }, ids.test, decision)).toBe("already_sent");
    expect(sent).toHaveLength(1);
  });

  it("concurrent runs send exactly one email", async () => {
    await resetClaim();
    const { t, sent } = fakeTransport();
    const results = await Promise.all([1, 2, 3].map(() => notifyWinnerFound({ db, transport: t, config }, ids.test, decision)));
    expect(results.filter((r) => r === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("releases the claim when sending fails, so the next run retries", async () => {
    await resetClaim();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: MailTransport = { sendMail: async () => { throw new Error("smtp down"); } };
    expect(await notifyWinnerFound({ db, transport: failing, config }, ids.test, decision)).toBe("failed");
    const [t1] = await db.select().from(schema.tests).where(eq(schema.tests.id, ids.test));
    expect(t1.winnerNotifiedAt).toBeNull();
    const ok = fakeTransport();
    expect(await notifyWinnerFound({ db, transport: ok.t, config }, ids.test, decision)).toBe("sent");
    spy.mockRestore();
  });

  it("uses NOTIFY_EMAIL recipients when given", async () => {
    await resetClaim();
    const { t, sent } = fakeTransport();
    await notifyWinnerFound({ db, transport: t, config: { ...config, recipients: " a@x.dev, b@x.dev " } }, ids.test, decision);
    expect(sent[0].to).toBe("a@x.dev, b@x.dev");
  });
});

describe("purgeOldData", () => {
  const ev = (days: number) => ({ siteId: ids.site, testId: ids.test, variantId: ids.a, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: "desktop", type: "heartbeat", url: "/", ts: ago(days) });
  const opts = { eventRetentionDays: 90, fullSnapshotDays: 30, now: NOW };

  it("cutoff is days before now", () => {
    expect(cutoff(NOW, 90).toISOString()).toBe("2026-06-22T12:00:00.000Z");
  });

  it("drops raw events past retention (in batches) and keeps recent ones", async () => {
    await db.insert(schema.events).values([ev(200), ev(120), ev(91), ev(89), ev(1), ev(0)]);
    const r = await purgeOldData(db as Database, { ...opts, batchSize: 2 });
    expect(r.events).toBe(3);
    const left = await db.select().from(schema.events);
    expect(left).toHaveLength(3);
    expect(left.every((e: any) => e.ts >= ago(90))).toBe(true);
    expect((await purgeOldData(db as Database, opts)).events).toBe(0);
  });

  it("keeps aggregates: pageviews and heat bins are never touched", async () => {
    await db.insert(schema.pageviews).values({ testId: ids.test, variantId: ids.a, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: "desktop", createdAt: ago(400), updatedAt: ago(400) });
    await db.insert(schema.heatBins).values({ testId: ids.test, variantId: ids.a, device: "desktop", layer: "click", selector: "#x", count: 1, weight: "1" });
    await purgeOldData(db as Database, opts);
    expect(await db.select().from(schema.pageviews)).toHaveLength(1);
    expect(await db.select().from(schema.heatBins)).toHaveLength(1);
  });

  it("thins old stats snapshots to the newest per test per day, and keeps recent ones whole", async () => {
    const snap = (at: Date) => ({ testId: ids.test, computedAt: at, status: "running", result: {} });
    const day40 = new Date(ago(40).setUTCHours(8)); // three hourly snapshots on one old day
    await db.insert(schema.statsSnapshots).values([snap(day40), snap(new Date(day40.getTime() + 3_600_000)), snap(new Date(day40.getTime() + 7_200_000)), snap(ago(2)), snap(new Date(ago(2).getTime() + 3_600_000))]);
    const r = await purgeOldData(db as Database, opts);
    expect(r.snapshots).toBe(2);
    const left = await db.select().from(schema.statsSnapshots);
    expect(left).toHaveLength(3);
    expect(left.some((s: any) => s.computedAt.getTime() === day40.getTime() + 7_200_000)).toBe(true);
  });

  it("removes expired sessions and long-dead OAuth codes and tokens", async () => {
    const [u] = await db.select().from(schema.users);
    await db.insert(schema.sessions).values([{ userId: u.id, expiresAt: ago(1) }, { userId: u.id, expiresAt: new Date(NOW.getTime() + DAY) }]);
    await db.insert(schema.oauthClients).values({ clientId: "c1", metadata: {} });
    await db.insert(schema.oauthCodes).values([
      { codeHash: "old", clientId: "c1", userId: u.id, redirectUri: "x", codeChallenge: "x", scopes: [], expiresAt: ago(20) },
      { codeHash: "new", clientId: "c1", userId: u.id, redirectUri: "x", codeChallenge: "x", scopes: [], expiresAt: new Date(NOW.getTime() + 600_000) },
    ]);
    await db.insert(schema.oauthTokens).values([
      { tokenHash: "dead", kind: "access", familyId: crypto.randomUUID(), clientId: "c1", userId: u.id, scopes: [], expiresAt: ago(30) },
      { tokenHash: "revoked", kind: "refresh", familyId: crypto.randomUUID(), clientId: "c1", userId: u.id, scopes: [], expiresAt: new Date(NOW.getTime() + 30 * DAY), revokedAt: ago(10) },
      { tokenHash: "live", kind: "refresh", familyId: crypto.randomUUID(), clientId: "c1", userId: u.id, scopes: [], expiresAt: new Date(NOW.getTime() + 30 * DAY) },
    ]);
    const r = await purgeOldData(db as Database, opts);
    expect(r).toMatchObject({ sessions: 1, oauthCodes: 1, oauthTokens: 2 });
    expect((await db.select().from(schema.oauthTokens)).map((t: any) => t.tokenHash)).toEqual(["live"]);
    expect(await db.select().from(schema.sessions)).toHaveLength(1);
  });
});
