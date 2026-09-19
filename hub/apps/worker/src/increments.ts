import type { QueuedTrackerEventInput } from "@tcw/shared";

const MAX_HEARTBEAT_DELTA_MS = 10_000;

/**
 * Pure mapping from one raw event to the pageviews-row deltas it
 * contributes. Deliberately has zero imports beyond @tcw/shared's types —
 * keep it that way so it stays trivially unit-testable (see
 * __tests__/process-event.test.ts) without needing DATABASE_URL/REDIS_URL
 * set up just to import it.
 */
export function deriveIncrements(
  event: QueuedTrackerEventInput,
  opts: { goalOnly?: boolean } = {},
): {
  activeMs: number;
  maxScrollPct: number;
  clicked: boolean;
  rageClicks: number;
} {
  const data = event.data ?? {};

  if (event.type === "heartbeat") {
    const raw = typeof data.deltaMs === "number" ? data.deltaMs : 5000;
    const activeMs = Math.max(0, Math.min(raw, MAX_HEARTBEAT_DELTA_MS));
    return { activeMs, maxScrollPct: 0, clicked: false, rageClicks: 0 };
  }

  if (event.type === "scroll_depth") {
    const pct = typeof data.pct === "number" ? Math.max(0, Math.min(100, data.pct)) : 0;
    return { activeMs: 0, maxScrollPct: pct, clicked: false, rageClicks: 0 };
  }

  if (event.type === "click") {
    // Element tests convert only on a goal-flagged element; page tests count any click.
    const clicked = opts.goalOnly ? typeof data.goal === "string" : true;
    return { activeMs: 0, maxScrollPct: 0, clicked, rageClicks: 0 };
  }

  if (event.type === "rage_click") {
    return { activeMs: 0, maxScrollPct: 0, clicked: false, rageClicks: 1 };
  }

  // pageview, scroll_stop, hover, visibility_end: no rollup increment in
  // phase 1 (heatmap consumers land in phase 4) — still ensure the
  // pageviews row exists via the zero-delta upsert in process-event.ts.
  return { activeMs: 0, maxScrollPct: 0, clicked: false, rageClicks: 0 };
}
