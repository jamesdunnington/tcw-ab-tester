import { and, desc, eq, inArray } from "drizzle-orm";
import { changeOpsSchema, type DecisionInput } from "@tcw/shared";
import { auditLog, decisions, sites, statsSnapshots, tests, variants } from "@tcw/db";
import { getDb } from "../context.js";
import { buildRuntimeConfig } from "../config-builder.js";
import { finalizeTest, pushRuntimeConfig, type FinalizeManifest } from "../wp-client.js";
import { fail, ok, type ServiceResult } from "../result.js";
import { recordLibraryItem, snapshotVariants } from "./library.js";

const DECIDABLE = ["winner_found", "inconclusive"] as const;

/** Who is acting: the dashboard user, or an MCP client acting for that user. Goes into decisions and the audit log. */
export interface Actor {
  userId: string;
  /** Shown in the audit log, e.g. "me@example.com" or "mcp:Claude:me@example.com". */
  label: string;
}

/**
 * The winner flow (docs/PLAN.md section 6): record the decision, promote the winner on WordPress,
 * delete or retire the redundant copies, archive the test. Page tests promote the winning copy into
 * the original post; element tests store the winning edits as a permanent rule.
 */
export async function applyDecision(testId: string, input: DecisionInput, actor: Actor): Promise<ServiceResult<{ manifest: FinalizeManifest }>> {
  const db = getDb();
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return fail(404, "test_not_found");
  if (!(DECIDABLE as readonly string[]).includes(test.status)) return fail(409, "test_not_decidable", { status: test.status });

  const variantRows = await db.select().from(variants).where(eq(variants.testId, testId));
  const chosen = variantRows.find((v) => v.key === input.chosenVariantKey);
  if (!chosen) return fail(400, "unknown_variant");

  const [latest] = await db.select().from(statsSnapshots).where(eq(statsSnapshots.testId, testId)).orderBy(desc(statsSnapshots.computedAt)).limit(1);
  const recommended = latest?.winnerKey ?? null;
  if (recommended && recommended !== chosen.key && !input.reason?.trim()) {
    return fail(400, "reason_required_when_overriding_recommendation", { recommended });
  }

  const [site] = await db.select().from(sites).where(eq(sites.id, test.siteId)).limit(1);
  if (!site) return fail(404, "site_not_found");

  // Element tests have no variant copy to delete. The winning edits become a permanent rule,
  // served to everyone with no tracking, so goal markers are dropped.
  const isElement = test.type === "element";
  const deleteRedundant = isElement ? false : input.deleteRedundant;
  const permanentOps = isElement && !chosen.isControl ? changeOpsSchema.catch([]).parse(chosen.changeOps ?? []).filter((o) => o.op !== "goal") : undefined;

  // Atomic claim: a double-click or second tab cannot run the flow twice.
  const previousStatus = test.status;
  const claimed = await db
    .update(tests)
    .set({ status: "finalising" })
    .where(and(eq(tests.id, testId), inArray(tests.status, [...DECIDABLE])))
    .returning({ id: tests.id });
  if (claimed.length === 0) return fail(409, "test_not_decidable");

  try {
    // 0. Copy the variants' content while they still exist: the library keeps it after the cleanup below.
    const snapshots = test.type === "page" ? await snapshotVariants(site, test, variantRows) : {};
    // 1. Stop splitting BEFORE anything is deleted, or visitors could be sent to a deleted URL.
    await pushRuntimeConfig(site, await buildRuntimeConfig(site.id));
    // 2. Promote, then delete/retire. WordPress refuses to delete if promotion fails.
    const manifest = await finalizeTest(site, {
      testId: test.id,
      testName: test.name,
      sourcePostId: test.wpPostId,
      chosenKey: chosen.key,
      deleteRedundant,
      permanentOps,
      startedAt: test.startedAt?.toISOString() ?? null,
      variants: variantRows.map((v) => ({ key: v.key, postId: v.wpPostId, isControl: v.isControl })),
    });

    await db.insert(decisions).values({
      testId,
      chosenVariantId: chosen.id,
      recommendedVariantKey: recommended,
      deleteRedundant,
      reason: input.reason ?? null,
      decidedBy: actor.userId,
      cleanupManifest: manifest,
    });
    await db.update(tests).set({ status: "archived", endedAt: new Date() }).where(eq(tests.id, testId));
    await db.insert(auditLog).values({
      actor: actor.label,
      action: "test.decided",
      target: testId,
      meta: { chosen: chosen.key, recommended, deleteRedundant, errors: manifest.errors.length },
    });
    // Library: best effort. The decision is already final; a failure here must not undo it.
    await recordLibraryItem({ test, site, variantRows, chosen, finalStats: latest?.result ?? null, snapshots }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[core] could not record the library item:", e);
    });
    return ok({ manifest });
  } catch (err) {
    // Nothing was deleted if we got here before finalize succeeded: restore the test and its live config.
    await db.update(tests).set({ status: previousStatus }).where(eq(tests.id, testId));
    await pushRuntimeConfig(site, await buildRuntimeConfig(site.id)).catch(() => undefined);
    return fail(502, "finalize_failed", err instanceof Error ? err.message : String(err));
  }
}
