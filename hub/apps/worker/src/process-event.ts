import { sql } from "drizzle-orm";
import { events, assignments, heatBins, pageviews } from "@tcw/db";
import type { QueuedTrackerEventInput } from "@tcw/shared";
import { db } from "./db.js";
import { resolveVariant } from "./variant-cache.js";
import { deriveIncrements } from "./increments.js";
import { deriveHeatBins } from "./heat.js";

/** Persists one raw event and folds it into the (session, test) pageview rollup. */
export async function processEvent(event: QueuedTrackerEventInput): Promise<void> {
  const resolved = await resolveVariant(event.testId, event.variantKey);
  const variantId = resolved?.id;
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

  const deltas = deriveIncrements(event, { goalOnly: resolved?.testType === "element" });

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
      sectionsSeen: deltas.sectionsSeen,
      sectionsTotal: deltas.sectionsTotal,
    })
    .onConflictDoUpdate({
      target: [pageviews.sessionId, pageviews.testId],
      set: {
        activeMs: sql`${pageviews.activeMs} + excluded.active_ms`,
        maxScrollPct: sql`GREATEST(${pageviews.maxScrollPct}, excluded.max_scroll_pct)`,
        clicked: sql`${pageviews.clicked} OR excluded.clicked`,
        rageClicks: sql`${pageviews.rageClicks} + excluded.rage_clicks`,
        sectionsSeen: sql`${pageviews.sectionsSeen} + excluded.sections_seen`,
        sectionsTotal: sql`GREATEST(${pageviews.sectionsTotal}, excluded.sections_total)`,
        updatedAt: new Date(),
      },
    });

  for (const bin of deriveHeatBins(event)) {
    await db
      .insert(heatBins)
      .values({
        testId: event.testId,
        variantId,
        device: event.device,
        layer: bin.layer,
        selector: bin.selector,
        cellX: bin.cellX,
        cellY: bin.cellY,
        count: bin.count,
        weight: bin.weight.toFixed(2),
      })
      .onConflictDoUpdate({
        target: [heatBins.testId, heatBins.variantId, heatBins.device, heatBins.layer, heatBins.selector, heatBins.cellX, heatBins.cellY],
        set: { count: sql`${heatBins.count} + excluded.count`, weight: sql`${heatBins.weight} + excluded.weight` },
      });
  }
}
