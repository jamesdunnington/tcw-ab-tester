import { sql } from "drizzle-orm";
import { events, assignments, pageviews } from "@tcw/db";
import type { QueuedTrackerEventInput } from "@tcw/shared";
import { db } from "./db.js";
import { resolveVariantId } from "./variant-cache.js";
import { deriveIncrements } from "./increments.js";

/** Persists one raw event and folds it into the (session, test) pageview rollup. */
export async function processEvent(event: QueuedTrackerEventInput): Promise<void> {
  const variantId = await resolveVariantId(event.testId, event.variantKey);
  if (!variantId) {
    // Unknown/removed variant (e.g. test archived after the visitor loaded
    // the page) — drop rather than fail the whole batch.
    return;
  }

  await db.insert(events).values({
    siteId: event.siteId,
    testId: event.testId,
    variantId,
    visitorId: event.visitorId,
    sessionId: event.sessionId,
    device: event.device,
    type: event.type,
    url: event.url,
    data: event.data ?? null,
    ts: new Date(event.ts),
  });

  await db
    .insert(assignments)
    .values({
      siteId: event.siteId,
      testId: event.testId,
      variantId,
      visitorId: event.visitorId,
      sessionId: event.sessionId,
      device: event.device,
    })
    .onConflictDoNothing({ target: [assignments.testId, assignments.visitorId] });

  const deltas = deriveIncrements(event);

  await db
    .insert(pageviews)
    .values({
      testId: event.testId,
      variantId,
      visitorId: event.visitorId,
      sessionId: event.sessionId,
      device: event.device,
      activeMs: deltas.activeMs,
      maxScrollPct: String(deltas.maxScrollPct),
      clicked: deltas.clicked,
      rageClicks: deltas.rageClicks,
    })
    .onConflictDoUpdate({
      target: [pageviews.sessionId, pageviews.testId],
      set: {
        activeMs: sql`${pageviews.activeMs} + excluded.active_ms`,
        maxScrollPct: sql`GREATEST(${pageviews.maxScrollPct}, excluded.max_scroll_pct)`,
        clicked: sql`${pageviews.clicked} OR excluded.clicked`,
        rageClicks: sql`${pageviews.rageClicks} + excluded.rage_clicks`,
        updatedAt: new Date(),
      },
    });
}
