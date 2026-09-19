import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "./context.js";
import { tests, variants } from "@tcw/db";
import { changeOpsSchema, mergeGoalOps, type ChangeOp } from "@tcw/shared";
import type { RuntimeConfigPushEntry } from "./wp-client.js";

/**
 * Builds the active-test config for one site: every "running" test plus its
 * variants, in the shape both the push path (wp-client.ts) and the WP pull
 * fallback (routes/wp.ts) send down to the plugin.
 */
export async function buildRuntimeConfig(siteId: string): Promise<RuntimeConfigPushEntry[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tests)
    .where(and(eq(tests.siteId, siteId), isNull(tests.endedAt), inArray(tests.status, ["running", "winner_found", "inconclusive"])));

  const out: RuntimeConfigPushEntry[] = [];
  for (const test of rows) {
    const variantRows = await db.select().from(variants).where(eq(variants.testId, test.id));
    // Element tests ship each variant's ops. Goals are shared so the control converts on the same elements.
    let opsByRow: ChangeOp[][] | null = null;
    if (test.type === "element") {
      opsByRow = mergeGoalOps(variantRows.map((v) => changeOpsSchema.catch([]).parse(v.changeOps ?? [])));
    }
    out.push({
      testId: test.id,
      type: test.type,
      status: test.status,
      wpPostId: test.wpPostId,
      variants: variantRows.map((v, i) => ({
        key: v.key,
        weight: v.trafficWeight,
        isControl: v.isControl,
        redirectUrl: test.type === "page" && !v.isControl ? (v.previewUrl ?? undefined) : undefined,
        ops: opsByRow?.[i],
      })),
    });
  }
  return out;
}
