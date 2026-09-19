import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { decisionInputSchema, RECOMPUTE_TEST_JOB } from "@tcw/shared";
import { auditLog, decisions, sites, statsSnapshots, tests, variants } from "@tcw/db";
import { db } from "../db/client.js";
import { requireAuth } from "../lib/session.js";
import { buildRuntimeConfig } from "../lib/config-builder.js";
import { statsQueue } from "../lib/queue.js";
import { finalizeTest, pushRuntimeConfig } from "../lib/wp-client.js";

const DECIDABLE = ["winner_found", "inconclusive"] as const;

type StoredResult = { variants?: Array<{ key: string; pBest?: number }> };

export async function decisionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/tests/:id/stats", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const snapshots = await db
      .select()
      .from(statsSnapshots)
      .where(eq(statsSnapshots.testId, id))
      .orderBy(desc(statsSnapshots.computedAt))
      .limit(200);
    const [decision] = await db.select().from(decisions).where(eq(decisions.testId, id)).limit(1);

    const latest = snapshots[0];
    return reply.send({
      latest: latest ? { computedAt: latest.computedAt, status: latest.status, winnerKey: latest.winnerKey, ...(latest.result as object) } : null,
      // Oldest first, reduced to the leader's P(best): the confidence-over-time trend.
      history: snapshots
        .slice()
        .reverse()
        .map((s) => ({
          computedAt: s.computedAt,
          status: s.status,
          leaderPBest: Math.max(0, ...((s.result as StoredResult).variants ?? []).map((v) => v.pBest ?? 0)),
        })),
      decision: decision ?? null,
    });
  });

  app.post("/api/tests/:id/recompute", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await statsQueue.add(RECOMPUTE_TEST_JOB, { testId: id });
    return reply.code(202).send({ queued: true });
  });

  // The winner flow (docs/PLAN.md section 6): record the decision, promote the winner
  // on WordPress, delete or retire the redundant copies, archive the test.
  app.post("/api/tests/:id/decision", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = decisionInputSchema.parse(request.body);

    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });
    if (!(DECIDABLE as readonly string[]).includes(test.status)) return reply.code(409).send({ error: "test_not_decidable", status: test.status });

    const variantRows = await db.select().from(variants).where(eq(variants.testId, id));
    const chosen = variantRows.find((v) => v.key === body.chosenVariantKey);
    if (!chosen) return reply.code(400).send({ error: "unknown_variant" });

    const [latest] = await db.select().from(statsSnapshots).where(eq(statsSnapshots.testId, id)).orderBy(desc(statsSnapshots.computedAt)).limit(1);
    const recommended = latest?.winnerKey ?? null;
    if (recommended && recommended !== chosen.key && !body.reason?.trim()) {
      return reply.code(400).send({ error: "reason_required_when_overriding_recommendation", recommended });
    }

    const [site] = await db.select().from(sites).where(eq(sites.id, test.siteId)).limit(1);
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    // Atomic claim: a double-click or second tab cannot run the flow twice.
    const previousStatus = test.status;
    const claimed = await db
      .update(tests)
      .set({ status: "finalising" })
      .where(and(eq(tests.id, id), inArray(tests.status, [...DECIDABLE])))
      .returning({ id: tests.id });
    if (claimed.length === 0) return reply.code(409).send({ error: "test_not_decidable" });

    try {
      // 1. Stop splitting BEFORE anything is deleted, or visitors could be sent to a deleted URL.
      await pushRuntimeConfig(site, await buildRuntimeConfig(site.id));
      // 2. Promote, then delete/retire — WordPress refuses to delete if promotion fails.
      const manifest = await finalizeTest(site, {
        testId: test.id,
        testName: test.name,
        sourcePostId: test.wpPostId,
        chosenKey: chosen.key,
        deleteRedundant: body.deleteRedundant,
        startedAt: test.startedAt?.toISOString() ?? null,
        variants: variantRows.map((v) => ({ key: v.key, postId: v.wpPostId, isControl: v.isControl })),
      });

      await db.insert(decisions).values({
        testId: id,
        chosenVariantId: chosen.id,
        recommendedVariantKey: recommended,
        deleteRedundant: body.deleteRedundant,
        reason: body.reason ?? null,
        decidedBy: request.currentUser!.id,
        cleanupManifest: manifest,
      });
      await db.update(tests).set({ status: "archived", endedAt: new Date() }).where(eq(tests.id, id));
      await db.insert(auditLog).values({
        actor: request.currentUser!.email,
        action: "test.decided",
        target: id,
        meta: { chosen: chosen.key, recommended, deleteRedundant: body.deleteRedundant, errors: manifest.errors.length },
      });
      return reply.send({ ok: true, manifest });
    } catch (err) {
      // Nothing was deleted if we got here before finalize succeeded: restore the test and its live config.
      await db.update(tests).set({ status: previousStatus }).where(eq(tests.id, id));
      await pushRuntimeConfig(site, await buildRuntimeConfig(site.id)).catch(() => undefined);
      return reply.code(502).send({ error: "finalize_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
}
