import { desc, eq, sql } from "drizzle-orm";
import { decisions, events, pageviews, statsSnapshots, tests, variants } from "@tcw/db";
import { getDb } from "../context.js";
import { fail, ok, type ServiceResult } from "../result.js";

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct1 = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);

type StoredResult = { variants?: Array<{ key: string; pBest?: number }> };

/** Latest stats snapshot (gates, per-variant analysis, SRM), the confidence trend, and the decision if one was made. */
export async function getStats(testId: string) {
  const db = getDb();
  const snapshots = await db.select().from(statsSnapshots).where(eq(statsSnapshots.testId, testId)).orderBy(desc(statsSnapshots.computedAt)).limit(200);
  const [decision] = await db.select().from(decisions).where(eq(decisions.testId, testId)).limit(1);
  const latest = snapshots[0];
  return {
    latest: latest ? { computedAt: latest.computedAt, status: latest.status, winnerKey: latest.winnerKey, ...(latest.result as object) } : null,
    // Oldest first, reduced to the leader's P(best): the confidence-over-time trend.
    history: snapshots
      .slice()
      .reverse()
      .map((s) => ({
        computedAt: s.computedAt,
        status: s.status,
        leaderPBest: Math.max(0, ...((s.result as StoredResult).variants ?? []).map((v) => v.pBest ?? 0)),
      })),
    decision: decision ?? null,
  };
}

/** Simple per-variant aggregates straight off the pageviews rollup. */
export async function getResults(testId: string) {
  const db = getDb();
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return null;
  const variantRows = await db.select().from(variants).where(eq(variants.testId, testId));

  const agg = await db
    .select({
      variantId: pageviews.variantId,
      sessions: sql<number>`count(*)`.mapWith(Number),
      avgActiveMs: sql<number>`coalesce(avg(${pageviews.activeMs}), 0)`.mapWith(Number),
      avgMaxScrollPct: sql<number>`coalesce(avg(${pageviews.maxScrollPct}), 0)`.mapWith(Number),
      clicks: sql<number>`coalesce(sum(case when ${pageviews.clicked} then 1 else 0 end), 0)`.mapWith(Number),
      rageClicks: sql<number>`coalesce(sum(${pageviews.rageClicks}), 0)`.mapWith(Number),
    })
    .from(pageviews)
    .where(eq(pageviews.testId, testId))
    .groupBy(pageviews.variantId);
  const byVariant = new Map(agg.map((row) => [row.variantId, row]));

  const results = variantRows.map((variant) => {
    const row = byVariant.get(variant.id);
    const sessions = row?.sessions ?? 0;
    return {
      variantId: variant.id,
      key: variant.key,
      label: variant.label,
      isControl: variant.isControl,
      sessions,
      avgActiveSeconds: row ? round1(row.avgActiveMs / 1000) : 0,
      avgScrollDepthPct: row ? round1(row.avgMaxScrollPct) : 0,
      clickRate: row ? pct1(row.clicks, sessions) : 0,
      rageClicks: row?.rageClicks ?? 0,
    };
  });
  return { test: { id: test.id, name: test.name, status: test.status, startedAt: test.startedAt }, results };
}

/**
 * Everything an analyst (human or AI) needs to reason about a test beyond "who won": distributions,
 * device split, day-by-day trend, and goal-level click/hover behaviour, per variant. Numbers only;
 * the verdict and its gates come from getStats.
 */
export async function getAnalytics(testId: string): Promise<ServiceResult<Record<string, unknown>>> {
  const db = getDb();
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return fail(404, "test_not_found");
  const variantRows = await db.select().from(variants).where(eq(variants.testId, testId));
  const label = new Map(variantRows.map((v) => [v.id, { key: v.key, label: v.label, isControl: v.isControl }]));

  const overall = await db
    .select({
      variantId: pageviews.variantId,
      sessions: sql<number>`count(*)`.mapWith(Number),
      visitors: sql<number>`count(distinct ${pageviews.visitorId})`.mapWith(Number),
      avgActiveMs: sql<number>`coalesce(avg(${pageviews.activeMs}), 0)`.mapWith(Number),
      medianActiveMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${pageviews.activeMs}), 0)`.mapWith(Number),
      p90ActiveMs: sql<number>`coalesce(percentile_cont(0.9) within group (order by ${pageviews.activeMs}), 0)`.mapWith(Number),
      avgScrollPct: sql<number>`coalesce(avg(${pageviews.maxScrollPct}), 0)`.mapWith(Number),
      clicked: sql<number>`coalesce(sum(case when ${pageviews.clicked} then 1 else 0 end), 0)`.mapWith(Number),
      rageClicks: sql<number>`coalesce(sum(${pageviews.rageClicks}), 0)`.mapWith(Number),
      quickBounces: sql<number>`coalesce(sum(case when ${pageviews.activeMs} < 5000 and ${pageviews.maxScrollPct} = 0 then 1 else 0 end), 0)`.mapWith(Number),
      scroll0to25: sql<number>`coalesce(sum(case when ${pageviews.maxScrollPct} < 25 then 1 else 0 end), 0)`.mapWith(Number),
      scroll25to50: sql<number>`coalesce(sum(case when ${pageviews.maxScrollPct} >= 25 and ${pageviews.maxScrollPct} < 50 then 1 else 0 end), 0)`.mapWith(Number),
      scroll50to75: sql<number>`coalesce(sum(case when ${pageviews.maxScrollPct} >= 50 and ${pageviews.maxScrollPct} < 75 then 1 else 0 end), 0)`.mapWith(Number),
      scroll75to100: sql<number>`coalesce(sum(case when ${pageviews.maxScrollPct} >= 75 then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(pageviews)
    .where(eq(pageviews.testId, testId))
    .groupBy(pageviews.variantId);

  const byDevice = await db
    .select({
      variantId: pageviews.variantId,
      device: pageviews.device,
      sessions: sql<number>`count(*)`.mapWith(Number),
      avgActiveMs: sql<number>`coalesce(avg(${pageviews.activeMs}), 0)`.mapWith(Number),
      avgScrollPct: sql<number>`coalesce(avg(${pageviews.maxScrollPct}), 0)`.mapWith(Number),
      clicked: sql<number>`coalesce(sum(case when ${pageviews.clicked} then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(pageviews)
    .where(eq(pageviews.testId, testId))
    .groupBy(pageviews.variantId, pageviews.device);

  const day = sql<string>`to_char(date_trunc('day', ${pageviews.createdAt}), 'YYYY-MM-DD')`;
  const daily = await db
    .select({
      variantId: pageviews.variantId,
      day,
      sessions: sql<number>`count(*)`.mapWith(Number),
      avgActiveMs: sql<number>`coalesce(avg(${pageviews.activeMs}), 0)`.mapWith(Number),
      clicked: sql<number>`coalesce(sum(case when ${pageviews.clicked} then 1 else 0 end), 0)`.mapWith(Number),
    })
    .from(pageviews)
    .where(eq(pageviews.testId, testId))
    .groupBy(pageviews.variantId, day)
    .orderBy(day);

  const goalName = sql<string>`coalesce(${events.data}->>'goal', '')`;
  const goalRows = await db
    .select({
      variantId: events.variantId,
      goal: goalName,
      type: events.type,
      events: sql<number>`count(*)`.mapWith(Number),
      sessions: sql<number>`count(distinct ${events.sessionId})`.mapWith(Number),
      avgHoverMs: sql<number>`coalesce(avg((${events.data}->>'durationMs')::numeric), 0)`.mapWith(Number),
    })
    .from(events)
    .where(sql`${events.testId} = ${testId} and ${events.type} in ('click', 'hover') and ${events.data}->>'goal' is not null`)
    .groupBy(events.variantId, goalName, events.type);

  const sessionsOf = new Map(overall.map((o) => [o.variantId, o.sessions]));
  const totalSessions = overall.reduce((n, o) => n + o.sessions, 0);

  return ok({
    test: {
      id: test.id,
      name: test.name,
      type: test.type,
      status: test.status,
      wpPermalink: test.wpPermalink,
      startedAt: test.startedAt,
      endedAt: test.endedAt,
      daysRunning: test.startedAt ? round1(((test.endedAt ?? new Date()).getTime() - test.startedAt.getTime()) / 86_400_000) : 0,
      minSampleSize: test.minSampleSize,
      trafficSplit: test.trafficSplit,
      totalSessions,
    },
    variants: overall.map((o) => ({
      ...label.get(o.variantId),
      sessions: o.sessions,
      visitors: o.visitors,
      // For element tests only goal-flagged clicks count as conversions; page tests count any click.
      conversionRatePct: pct1(o.clicked, o.sessions),
      avgActiveSeconds: round1(o.avgActiveMs / 1000),
      medianActiveSeconds: round1(o.medianActiveMs / 1000),
      p90ActiveSeconds: round1(o.p90ActiveMs / 1000),
      avgScrollDepthPct: round1(o.avgScrollPct),
      scrollDepthDistributionPct: {
        "0-25": pct1(o.scroll0to25, o.sessions),
        "25-50": pct1(o.scroll25to50, o.sessions),
        "50-75": pct1(o.scroll50to75, o.sessions),
        "75-100": pct1(o.scroll75to100, o.sessions),
      },
      quickBounceRatePct: pct1(o.quickBounces, o.sessions),
      rageClicks: o.rageClicks,
      rageClicksPer100Sessions: round1(o.sessions > 0 ? (o.rageClicks / o.sessions) * 100 : 0),
    })),
    byDevice: byDevice.map((d) => ({
      ...label.get(d.variantId),
      device: d.device,
      sessions: d.sessions,
      conversionRatePct: pct1(d.clicked, d.sessions),
      avgActiveSeconds: round1(d.avgActiveMs / 1000),
      avgScrollDepthPct: round1(d.avgScrollPct),
    })),
    daily: daily.map((d) => ({
      ...label.get(d.variantId),
      day: d.day,
      sessions: d.sessions,
      conversionRatePct: pct1(d.clicked, d.sessions),
      avgActiveSeconds: round1(d.avgActiveMs / 1000),
    })),
    goals: goalRows.map((g) => ({
      ...label.get(g.variantId),
      goal: g.goal,
      kind: g.type,
      events: g.events,
      sessions: g.sessions,
      shareOfVariantSessionsPct: pct1(g.sessions, sessionsOf.get(g.variantId) ?? 0),
      ...(g.type === "hover" ? { avgHoverSeconds: round1(g.avgHoverMs / 1000) } : {}),
    })),
    notes: [
      "Percentages are of sessions (one session = one visit to the tested page).",
      "Visitors who have not given statistics consent are only counted for the sample-ratio check, so they are absent here.",
      "This is descriptive data. Whether a difference is real comes from get_results (probabilities, gates, sample-ratio check), not from eyeballing these numbers.",
    ],
  });
}
