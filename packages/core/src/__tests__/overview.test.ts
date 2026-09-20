import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@tcw/db";
import { configureCore } from "../context.js";
import { getOverview, summarizeSnapshot } from "../services/overview.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "hub", "apps", "api", "drizzle");

describe("summarizeSnapshot", () => {
  const result = {
    gates: [{ passed: true }, { passed: true }, { passed: false }],
    variants: [
      { key: "a", pBest: 0.1, lift: null },
      { key: "b", pBest: 0.9, lift: { estimate: 0.12345 } },
    ],
  };

  it("names the leading variant with its lift in percent and how many gates pass", () => {
    expect(summarizeSnapshot(result)).toEqual({ leaderKey: "b", liftPct: 12.35, pBest: 0.9, gatesPassed: 2, gatesTotal: 3 });
  });

  it("has no lift when the control leads", () => {
    const control = { gates: [], variants: [{ key: "a", pBest: 0.8, lift: null }, { key: "b", pBest: 0.2, lift: { estimate: -0.1 } }] };
    expect(summarizeSnapshot(control)).toMatchObject({ leaderKey: "a", liftPct: null, pBest: 0.8 });
  });

  it("copes with no snapshot yet, or one before any data", () => {
    expect(summarizeSnapshot(null)).toEqual({ leaderKey: null, liftPct: null, pBest: null, gatesPassed: 0, gatesTotal: 0 });
    expect(summarizeSnapshot({ gates: [], variants: [{ key: "a", pBest: 0, lift: null }, { key: "b", pBest: 0, lift: null }] }).leaderKey).toBeNull();
  });
});

describe("getOverview", () => {
  let pg: PGlite;
  const NOW = new Date("2026-09-20T12:00:00Z");
  const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

  beforeAll(async () => {
    pg = new PGlite();
    const db = drizzle(pg, { schema }) as any;
    await migrate(db, { migrationsFolder: MIGRATIONS });
    configureCore({ db, secretKeyHex: "ab".repeat(32) });

    const [s1, s2] = await db.insert(schema.sites).values([
      { domain: "one.test", displayName: "One", siteKey: "k1", secretEncrypted: "x" },
      { domain: "two.test", displayName: "Two", siteKey: "k2", secretEncrypted: "x" },
      { domain: "idle.test", displayName: "Idle", siteKey: "k3", secretEncrypted: "x" },
    ]).returning();
    const base = { wpPostId: 1, wpPermalink: "https://x.test/p" };
    const [running, winner] = await db.insert(schema.tests).values([
      { ...base, siteId: s1.id, name: "Running", status: "running", startedAt: day(3) },
      { ...base, siteId: s1.id, name: "Winner", status: "winner_found", startedAt: day(10), minRunDays: 7 },
      { ...base, siteId: s2.id, name: "Stopped", status: "inconclusive", startedAt: day(20), endedAt: day(12) },
      { ...base, siteId: s2.id, name: "Draft", status: "draft" },
      { ...base, siteId: s2.id, name: "Old", status: "archived", startedAt: day(40), endedAt: day(30) },
    ]).returning();

    const vrows = [];
    for (const t of [running, winner]) {
      vrows.push({ testId: t.id, key: "a", label: "Control", isControl: true, trafficWeight: 50 }, { testId: t.id, key: "b", label: "Challenger", isControl: false, trafficWeight: 50 });
    }
    const variants = await db.insert(schema.variants).values(vrows).returning();
    const a = variants.find((v: any) => v.testId === winner.id && v.key === "a");
    const b = variants.find((v: any) => v.testId === winner.id && v.key === "b");

    const snap = (pBest: number) => ({ gates: [{ passed: true }, { passed: false }], variants: [{ key: "a", pBest: 1 - pBest, lift: null }, { key: "b", pBest, lift: { estimate: 0.2 } }] });
    // Two snapshots: only the newest may be used.
    await db.insert(schema.statsSnapshots).values([
      { testId: winner.id, status: "running", winnerKey: null, result: snap(0.6), computedAt: day(2) },
      { testId: winner.id, status: "winner_found", winnerKey: "b", result: snap(0.97), computedAt: day(1) },
    ]);
    const pv = (t: any, v: any) => ({ testId: t.id, variantId: v.id, visitorId: crypto.randomUUID(), sessionId: crypto.randomUUID(), device: "desktop", activeMs: 1000, maxScrollPct: "10", clicked: false, rageClicks: 0 });
    await db.insert(schema.pageviews).values([pv(winner, a), pv(winner, b), pv(winner, b)]);
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  it("shows only tests that are live or waiting on a decision, split into two groups", async () => {
    const o = await getOverview(NOW);
    expect(o.tests.map((t) => [t.name, t.group]).sort()).toEqual([["Running", "live"], ["Stopped", "decide"], ["Winner", "decide"]]);
  });

  it("puts a ready winner before an inconclusive test in the decide group", async () => {
    const decide = (await getOverview(NOW)).tests.filter((t) => t.group === "decide");
    expect(decide.map((t) => t.name)).toEqual(["Winner", "Stopped"]);
  });

  it("carries the newest snapshot's metrics, the session count and the days run", async () => {
    const winner = (await getOverview(NOW)).tests.find((t) => t.name === "Winner")!;
    expect(winner).toMatchObject({ siteName: "One", sessions: 3, daysRunning: 10, minRunDays: 7, leader: { key: "b", label: "Challenger", liftPct: 20, pBest: 0.97 }, gatesPassed: 1, gatesTotal: 2 });
  });

  it("stops the clock at endedAt for a test that was stopped", async () => {
    const stopped = (await getOverview(NOW)).tests.find((t) => t.name === "Stopped")!;
    expect(stopped.daysRunning).toBe(8);
    expect(stopped.leader).toBeNull();
  });

  it("counts live and waiting tests per site, including sites with none", async () => {
    const sites = (await getOverview(NOW)).sites;
    expect(sites.map((s) => [s.displayName, s.live, s.decide])).toEqual([["Idle", 0, 0], ["One", 1, 1], ["Two", 0, 1]]);
  });
});
