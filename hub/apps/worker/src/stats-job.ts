import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { events, pageviews, statsSnapshots, tests, variants } from "@tcw/db";
import { decideWinner, type WinnerDecision } from "@tcw/stats";
import { db } from "./db.js";
import { buildVariantData } from "./stats-input.js";

/** Statuses in which a test is still live and its stats are still being refreshed. */
const LIVE_STATUSES = ["running", "winner_found", "inconclusive"] as const;

export async function recomputeTest(testId: string, now = new Date()): Promise<WinnerDecision | null> {
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test || !test.startedAt || !(LIVE_STATUSES as readonly string[]).includes(test.status)) return null;

  const variantRows = await db.select().from(variants).where(eq(variants.testId, testId)).orderBy(asc(variants.key));
  if (variantRows.length < 2) return null;

  const pageviewRows = await db.select().from(pageviews).where(eq(pageviews.testId, testId));
  const hoverRows = await db
    .selectDistinct({ sessionId: events.sessionId })
    .from(events)
    // Hover is tracked on any interactive element (heatmap layer); an element test's score counts only goal hovers, as before.
    .where(and(eq(events.testId, testId), eq(events.type, "hover"), test.type === "element" ? sql`${events.data}->>'goal' is not null` : undefined));

  const data = buildVariantData(variantRows, pageviewRows, new Set(hoverRows.map((r) => r.sessionId)), test.wordCount, test.wpPostType);

  const decision = decideWinner(data, {
    minSampleSize: test.minSampleSize,
    minRunDays: test.minRunDays,
    confidenceThreshold: Number(test.confidenceThreshold),
    startedAt: test.startedAt,
    now,
  });

  await db.insert(statsSnapshots).values({
    testId,
    status: decision.status,
    winnerKey: decision.winnerKey,
    result: decision,
  });

  // Traffic keeps splitting until the user decides (docs/PLAN.md section 6), so the
  // test stays "live" — only the status label moves between the three live states.
  // A test the owner stopped manually (endedAt set) keeps the status they gave it.
  if (decision.status !== test.status && !test.endedAt) {
    await db.update(tests).set({ status: decision.status }).where(eq(tests.id, testId));
  }
  return decision;
}

export async function recomputeAllLive(now = new Date()): Promise<number> {
  const live = await db.select({ id: tests.id }).from(tests).where(inArray(tests.status, [...LIVE_STATUSES]));
  let done = 0;
  for (const t of live) {
    try {
      if (await recomputeTest(t.id, now)) done++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[worker] stats recompute failed for test ${t.id}:`, err);
    }
  }
  return done;
}
