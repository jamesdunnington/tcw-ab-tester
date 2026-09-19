import { and, eq } from "drizzle-orm";
import type { ChangeOp } from "@tcw/shared";
import { getDb } from "./context.js";
import { sites, tests, variants } from "@tcw/db";
import { pushRuntimeConfig } from "./wp-client.js";
import { buildRuntimeConfig } from "./config-builder.js";

export type SaveOpsResult =
  | { ok: true; variant: typeof variants.$inferSelect }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Replaces one variant's change ops. Shared by the dashboard route and the
 * token-authenticated editor route so both enforce the same rules.
 */
export async function saveVariantOps(testId: string, variantKey: string, ops: ChangeOp[]): Promise<SaveOpsResult> {
  const db = getDb();
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return { ok: false, status: 404, error: "test_not_found" };
  if (test.type !== "element") return { ok: false, status: 409, error: "not_an_element_test" };
  if (test.status === "archived" || test.status === "finalising") return { ok: false, status: 409, error: "test_is_closed" };

  const [variant] = await db
    .update(variants)
    .set({ changeOps: ops })
    .where(and(eq(variants.testId, testId), eq(variants.key, variantKey), eq(variants.isControl, false)))
    .returning();
  if (!variant) return { ok: false, status: 404, error: "variant_not_found" };

  // A live test picks the edit up right away.
  if (test.status === "running") {
    const [site] = await db.select().from(sites).where(eq(sites.id, test.siteId)).limit(1);
    if (site) await pushRuntimeConfig(site, await buildRuntimeConfig(site.id));
  }
  return { ok: true, variant };
}
