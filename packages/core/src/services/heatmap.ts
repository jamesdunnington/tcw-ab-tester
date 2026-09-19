import { and, eq, sql, type SQL } from "drizzle-orm";
import { heatBins, pageviews, tests, variants } from "@tcw/db";
import { HEAT_GRID, SCROLL_BINS, type HeatLayer } from "@tcw/shared";
import { getDb } from "../context.js";
import { fail, ok, type ServiceResult } from "../result.js";

export interface HeatFilters {
  variantKey?: string;
  device?: "desktop" | "tablet" | "mobile";
}

export interface HeatBinRow {
  layer: HeatLayer;
  selector: string;
  cellX: number;
  cellY: number;
  count: number;
  weight: number;
}

export interface HeatData {
  test: { id: string; name: string; type: string; permalink: string };
  variants: Array<{ key: string; label: string; isControl: boolean }>;
  filters: HeatFilters;
  /** Sessions the bins were collected from (the denominator for shares). */
  sessions: number;
  bins: HeatBinRow[];
  /** Share of sessions that scrolled at least this far, at 10% steps: the drop-off curve. */
  scrollReachPct: Array<{ depthPct: number; sessionsPct: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** The overlay draws at most this many bins; the busiest win. */
const MAX_BINS = 4000;

/** Filtered heat bins plus the session count, for the summary, the dashboard and the on-page overlay. */
export async function getHeatData(testId: string, filters: HeatFilters = {}): Promise<ServiceResult<HeatData>> {
  const db = getDb();
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return fail(404, "test_not_found");
  const variantRows = await db.select().from(variants).where(eq(variants.testId, testId));

  let variantId: string | undefined;
  if (filters.variantKey) {
    const v = variantRows.find((r) => r.key === filters.variantKey);
    if (!v) return fail(404, "variant_not_found");
    variantId = v.id;
  }

  const binWhere: SQL[] = [eq(heatBins.testId, testId)];
  const pvWhere: SQL[] = [eq(pageviews.testId, testId)];
  if (variantId) {
    binWhere.push(eq(heatBins.variantId, variantId));
    pvWhere.push(eq(pageviews.variantId, variantId));
  }
  if (filters.device) {
    binWhere.push(eq(heatBins.device, filters.device));
    pvWhere.push(eq(pageviews.device, filters.device));
  }

  const count = sql<number>`sum(${heatBins.count})`.mapWith(Number);
  const weight = sql<number>`sum(${heatBins.weight})`.mapWith(Number);
  const rows = await db
    .select({ layer: heatBins.layer, selector: heatBins.selector, cellX: heatBins.cellX, cellY: heatBins.cellY, count, weight })
    .from(heatBins)
    .where(and(...binWhere))
    .groupBy(heatBins.layer, heatBins.selector, heatBins.cellX, heatBins.cellY)
    .orderBy(sql`sum(${heatBins.count}) desc`)
    .limit(MAX_BINS);

  const reach = (min: number) => sql<number>`coalesce(sum(case when ${pageviews.maxScrollPct} >= ${min} then 1 else 0 end), 0)`.mapWith(Number);
  const [pv] = await db
    .select({
      sessions: sql<number>`count(*)`.mapWith(Number),
      r10: reach(10), r20: reach(20), r30: reach(30), r40: reach(40), r50: reach(50),
      r60: reach(60), r70: reach(70), r80: reach(80), r90: reach(90), r100: reach(100),
    })
    .from(pageviews)
    .where(and(...pvWhere));
  const sessions = pv?.sessions ?? 0;
  const reached = pv ? [pv.r10, pv.r20, pv.r30, pv.r40, pv.r50, pv.r60, pv.r70, pv.r80, pv.r90, pv.r100] : [];

  return ok({
    test: { id: test.id, name: test.name, type: test.type, permalink: test.wpPermalink },
    variants: variantRows.map((v) => ({ key: v.key, label: v.label, isControl: v.isControl })).sort((a, b) => a.key.localeCompare(b.key)),
    filters,
    sessions,
    bins: rows,
    scrollReachPct: reached.map((n, i) => ({ depthPct: (i + 1) * 10, sessionsPct: sessions > 0 ? round1((n / sessions) * 100) : 0 })),
  });
}

export interface TopElement {
  selector: string;
  count: number;
  /** Share of all events on this layer. */
  sharePct: number;
  /** Grid cell inside the element that took the most hits (click, rage and dead only). */
  hotspot?: { cellX: number; cellY: number };
  /** hover only: average seconds per hover. */
  avgHoverSeconds?: number;
  /** attention only: share of sessions that looked at it for a second or more. */
  sessionsPct?: number;
}

export interface HeatSummary {
  sessions: number;
  click: { total: number; top: TopElement[] };
  hover: { total: number; top: TopElement[] };
  attention: { total: number; top: TopElement[] };
  /** Clicks on something that is not a link, button or form control: people expect it to do something. */
  deadClicks: { total: number; top: TopElement[] };
  /** Three or more fast clicks in one spot: frustration. */
  rageClicks: { total: number; top: TopElement[] };
  scroll: {
    /** Where scrolling paused, in 5% bands of page height. */
    stops: Array<{ fromPct: number; toPct: number; stops: number; sharePct: number }>;
    busiestBand: { fromPct: number; toPct: number } | null;
    reachPct: HeatData["scrollReachPct"];
    /** The 10% step with the biggest fall in reach, i.e. where most people leave. */
    biggestDropAtPct: number | null;
  };
}

const TOP_N = 10;

function topOf(bins: HeatBinRow[], layer: HeatLayer, sessions: number): { total: number; top: TopElement[] } {
  const bySelector = new Map<string, { count: number; weight: number; best: HeatBinRow }>();
  let total = 0;
  for (const b of bins) {
    if (b.layer !== layer) continue;
    total += b.count;
    const cur = bySelector.get(b.selector);
    if (!cur) bySelector.set(b.selector, { count: b.count, weight: b.weight, best: b });
    else {
      cur.count += b.count;
      cur.weight += b.weight;
      if (b.count > cur.best.count) cur.best = b;
    }
  }
  const top = [...bySelector.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, TOP_N)
    .map(([selector, v]): TopElement => {
      const el: TopElement = { selector, count: v.count, sharePct: total > 0 ? round1((v.count / total) * 100) : 0 };
      if (layer === "click" || layer === "rage" || layer === "dead") el.hotspot = { cellX: v.best.cellX, cellY: v.best.cellY };
      if (layer === "hover") el.avgHoverSeconds = v.count > 0 ? round1(v.weight / v.count) : 0;
      if (layer === "attention") el.sessionsPct = sessions > 0 ? Math.min(100, round1((v.count / sessions) * 100)) : 0;
      return el;
    });
  return { total, top };
}

/** Pure: turns raw bins into the numbers an analyst (or Claude) reads. */
export function summarizeHeat(data: Pick<HeatData, "sessions" | "bins" | "scrollReachPct">): HeatSummary {
  const { bins, sessions } = data;

  const perBand = new Array<number>(SCROLL_BINS).fill(0);
  for (const b of bins) if (b.layer === "scroll" && b.cellY >= 0 && b.cellY < SCROLL_BINS) perBand[b.cellY] += b.count;
  const stopTotal = perBand.reduce((n, c) => n + c, 0);
  const step = 100 / SCROLL_BINS;
  const stops = perBand.map((c, i) => ({ fromPct: i * step, toPct: (i + 1) * step, stops: c, sharePct: stopTotal > 0 ? round1((c / stopTotal) * 100) : 0 }));
  const max = Math.max(...perBand);
  const busiest = max > 0 ? stops[perBand.indexOf(max)] : null;

  // Biggest fall between consecutive reach points (start of page = 100% reach).
  let drop: number | null = null;
  let worst = 0;
  let prev = sessions > 0 ? 100 : 0;
  for (const r of data.scrollReachPct) {
    const fall = prev - r.sessionsPct;
    if (fall > worst) {
      worst = fall;
      drop = r.depthPct;
    }
    prev = r.sessionsPct;
  }

  return {
    sessions,
    click: topOf(bins, "click", sessions),
    hover: topOf(bins, "hover", sessions),
    attention: topOf(bins, "attention", sessions),
    deadClicks: topOf(bins, "dead", sessions),
    rageClicks: topOf(bins, "rage", sessions),
    scroll: { stops, busiestBand: busiest ? { fromPct: busiest.fromPct, toPct: busiest.toPct } : null, reachPct: data.scrollReachPct, biggestDropAtPct: drop },
  };
}

/** The dashboard / Claude view of a test's heatmap: top elements per layer and the scroll drop-off. */
export async function getHeatmap(testId: string, filters: HeatFilters = {}): Promise<ServiceResult<Record<string, unknown>>> {
  const data = await getHeatData(testId, filters);
  if (!data.ok) return data;
  const { test, variants: vs, sessions } = data.data;
  return ok({
    test,
    variants: vs,
    filters,
    grid: { size: HEAT_GRID, note: "hotspot cellX/cellY is a position inside the element on a 10x10 grid, 0,0 = top left." },
    ...summarizeHeat(data.data),
    notes: [
      sessions === 0 ? "No sessions yet, so no heat data." : "Only visitors who gave statistics consent are recorded.",
      "Elements are identified by CSS selector. Percentages are of that layer's total, except attention (of sessions).",
      "Descriptive only: whether a variant won comes from get_results.",
    ],
  });
}
