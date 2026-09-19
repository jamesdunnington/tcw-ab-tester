import type { QueuedTrackerEventInput } from "@tcw/shared";

const MAX_HEARTBEAT_DELTA_MS = 10_000;

/**
 * Pure mapping from one raw event to the pageviews-row deltas it
 * contributes. Deliberately has zero imports beyond @tcw/shared's types —
 * keep it that way so it stays trivially unit-testable (see
 * __tests__/process-event.test.ts) without needing DATABASE_URL/REDIS_URL
 * set up just to import it.
 */
export interface Increments {
  activeMs: number;
  maxScrollPct: number;
  clicked: boolean;
  rageClicks: number;
  /** section_view: one more key section seen; sectionsTotal is how many the tracker observed (max wins). */
  sectionsSeen: number;
  sectionsTotal: number;
}

const NONE: Increments = { activeMs: 0, maxScrollPct: 0, clicked: false, rageClicks: 0, sectionsSeen: 0, sectionsTotal: 0 };

export function deriveIncrements(event: QueuedTrackerEventInput, opts: { goalOnly?: boolean } = {}): Increments {
  const data = event.data ?? {};

  if (event.type === "heartbeat") {
    const raw = typeof data.deltaMs === "number" ? data.deltaMs : 5000;
    const activeMs = Math.max(0, Math.min(raw, MAX_HEARTBEAT_DELTA_MS));
    return { ...NONE, activeMs };
  }

  if (event.type === "scroll_depth") {
    const pct = typeof data.pct === "number" ? Math.max(0, Math.min(100, data.pct)) : 0;
    return { ...NONE, maxScrollPct: pct };
  }

  if (event.type === "click") {
    // Element tests convert only on a goal-flagged element; page tests count any click.
    const clicked = opts.goalOnly ? typeof data.goal === "string" : true;
    return { ...NONE, clicked };
  }

  if (event.type === "rage_click") {
    return { ...NONE, rageClicks: 1 };
  }

  if (event.type === "section_view") {
    const total = typeof data.total === "number" ? Math.max(0, Math.min(100, Math.floor(data.total))) : 0;
    return { ...NONE, sectionsSeen: 1, sectionsTotal: total };
  }

  // pageview, scroll_stop, hover, visibility_end: no rollup increment (the heat
  // bins in heat.ts consume them) - still ensure the pageviews row exists via
  // the zero-delta upsert in process-event.ts.
  return { ...NONE };
}
