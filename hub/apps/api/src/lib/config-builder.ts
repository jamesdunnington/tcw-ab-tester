import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { tests, variants } from "@tcw/db";
import type { RuntimeConfigPushEntry } from "./wp-client.js";

/**
 * Builds the active-test config for one site: every "running" test plus its
 * variants, in the shape both the push path (wp-client.ts) and the WP pull
 * fallback (routes/wp.ts) send down to the plugin.
 */
export async function buildRuntimeConfig(siteId: string): Promise<RuntimeConfigPushEntry[]> {
  const rows = await db
    .select()
    .from(tests)
    .where(and(eq(tests.siteId, siteId), isNull(tests.endedAt), inArray(tests.status, ["running", "winner_found", "inconclusive"])));

  const out: RuntimeConfigPushEntry[] = [];
  for (const test of rows) {
    const variantRows = await db.select().from(variants).where(eq(variants.testId, test.id));
    out.push({
      testId: test.id,
      type: test.type,
      status: test.status,
      wpPostId: test.wpPostId,
      variants: variantRows.map((v) => ({
        key: v.key,
        weight: v.trafficWeight,
        isControl: v.isControl,
        redirectUrl: v.isControl ? undefined : (v.previewUrl ?? undefined),
      })),
    });
  }
  return out;
}
