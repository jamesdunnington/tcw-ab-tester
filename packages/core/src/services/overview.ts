import { desc, inArray, sql } from "drizzle-orm";
import { pageviews, sites, statsSnapshots, tests, variants } from "@tcw/db";
import { getDb } from "../context.js";

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "decide" = a winner is ready or the test was stopped, so it waits on a person; "live" = still collecting. */
export type OverviewGroup = "decide" | "live";

export interface OverviewTest {
  id: string;
  name: string;
  type: "page" | "element";
  status: string;
  group: OverviewGroup;
  siteId: string;
  siteName: string;
  siteDomain: string;
  startedAt: string | null;
  endedAt: string | null;
  daysRunning: number;
  minRunDays: number;
  sessions: number;
  leader: { key: string; label: string; liftPct: number | null; pBest: number } | null;
  gatesPassed: number;
  gatesTotal: number;
}

export interface OverviewSite {
  id: string;
  displayName: string;
  domain: string;
  live: number;
  decide: number;
}

type StoredResult = { gates?: Array<{ passed: boolean }>; variants?: Array<{ key: string; pBest?: number; lift?: { estimate: number | null } | null }> } | null;

/** Pure: what the overview keeps from a stats snapshot. The leader is whoever has the highest P(best), if there is any signal yet. */
export function summarizeSnapshot(result: StoredResult) {
  const gates = result?.gates ?? [];
  const leader = [...(result?.variants ?? [])].sort((a, b) => (b.pBest ?? 0) - (a.pBest ?? 0))[0];
  const known = leader && (leader.pBest ?? 0) > 0;
  const lift = leader?.lift?.estimate;
  return {
    leaderKey: known ? leader.key : null,
    liftPct: known && typeof lift === "number" ? Math.round(lift * 10_000) / 100 : null,
    pBest: known ? (leader.pBest as number) : null,
    gatesPassed: gates.filter((g) => g.passed).length,
    gatesTotal: gates.length,
  };
}

const GROUP_OF: Record<string, OverviewGroup | undefined> = { running: "live", winner_found: "decide", inconclusive: "decide" };

/**
 * Every test that is live or waiting on a decision across all sites, with its headline numbers, plus a
 * per-site count. One pass of a few queries instead of one request per site.
 */
export async function getOverview(now: Date = new Date()): Promise<{ tests: OverviewTest[]; sites: OverviewSite[] }> {
  const db = getDb();
  const siteRows = await db.select().from(sites).orderBy(sites.displayName);
  const siteById = new Map(siteRows.map((s) => [s.id, s]));

  const active = (await db.select().from(tests).where(inArray(tests.status, ["running", "winner_found", "inconclusive"]))).filter((t) => siteById.has(t.siteId));
  const ids = active.map((t) => t.id);

  const snapshots = ids.length
    ? await db.selectDistinctOn([statsSnapshots.testId], { testId: statsSnapshots.testId, result: statsSnapshots.result }).from(statsSnapshots).where(inArray(statsSnapshots.testId, ids)).orderBy(statsSnapshots.testId, desc(statsSnapshots.computedAt))
    : [];
  const counts = ids.length
    ? await db.select({ testId: pageviews.testId, n: sql<number>`count(*)`.mapWith(Number) }).from(pageviews).where(inArray(pageviews.testId, ids)).groupBy(pageviews.testId)
    : [];
  const variantRows = ids.length ? await db.select({ testId: variants.testId, key: variants.key, label: variants.label }).from(variants).where(inArray(variants.testId, ids)) : [];

  const snapshotOf = new Map(snapshots.map((s) => [s.testId, s.result as StoredResult]));
  const sessionsOf = new Map(counts.map((c) => [c.testId, c.n]));

  const rows: OverviewTest[] = active.map((t) => {
    const site = siteById.get(t.siteId)!;
    const s = summarizeSnapshot(snapshotOf.get(t.id) ?? null);
    const label = s.leaderKey ? variantRows.find((v) => v.testId === t.id && v.key === s.leaderKey)?.label ?? s.leaderKey : null;
    const end = t.endedAt ?? now;
    return {
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      group: GROUP_OF[t.status] as OverviewGroup,
      siteId: site.id,
      siteName: site.displayName,
      siteDomain: site.domain,
      startedAt: t.startedAt?.toISOString() ?? null,
      endedAt: t.endedAt?.toISOString() ?? null,
      daysRunning: t.startedAt ? round1(Math.max(0, (end.getTime() - t.startedAt.getTime()) / DAY_MS)) : 0,
      minRunDays: t.minRunDays,
      sessions: sessionsOf.get(t.id) ?? 0,
      leader: s.leaderKey ? { key: s.leaderKey, label: label as string, liftPct: s.liftPct, pBest: s.pBest as number } : null,
      gatesPassed: s.gatesPassed,
      gatesTotal: s.gatesTotal,
    };
  });

  // A ready winner comes before an inconclusive test; live tests list the longest-running first.
  const rank = (t: OverviewTest) => (t.status === "winner_found" ? 0 : 1);
  rows.sort((a, b) => (a.group === b.group ? (a.group === "decide" ? rank(a) - rank(b) : 0) || (a.startedAt ?? "").localeCompare(b.startedAt ?? "") : a.group === "decide" ? -1 : 1));

  const perSite = siteRows.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    domain: s.domain,
    live: rows.filter((t) => t.siteId === s.id && t.group === "live").length,
    decide: rows.filter((t) => t.siteId === s.id && t.group === "decide").length,
  }));
  return { tests: rows, sites: perSite };
}
