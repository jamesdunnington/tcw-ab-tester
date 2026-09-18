import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { pageviews, tests, variants } from "@tcw/db";
import { requireAuth } from "../lib/session.js";

/**
 * Phase 1 "basic results": simple per-variant aggregates straight off the
 * pageviews rollup table. No significance testing yet — that lands with
 * packages/stats in phase 2 (see docs/PLAN.md section 5).
 */
export async function resultRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/tests/:id/results", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });

    const variantRows = await db.select().from(variants).where(eq(variants.testId, id));

    const agg = await db
      .select({
        variantId: pageviews.variantId,
        sessions: sql<number>`count(*)`.mapWith(Number),
        avgActiveMs: sql<number>`coalesce(avg(${pageviews.activeMs}), 0)`.mapWith(Number),
        avgMaxScrollPct: sql<number>`coalesce(avg(${pageviews.maxScrollPct}), 0)`.mapWith(Number),
        clicks: sql<number>`coalesce(sum(case when ${pageviews.clicked} then 1 else 0 end), 0)`.mapWith(Number),
        rageClicks: sql<number>`coalesce(sum(${pageviews.rageClicks}), 0)`.mapWith(Number),
      })
      .from(pageviews)
      .where(eq(pageviews.testId, id))
      .groupBy(pageviews.variantId);

    const aggByVariant = new Map(agg.map((row) => [row.variantId, row]));

    const results = variantRows.map((variant) => {
      const row = aggByVariant.get(variant.id);
      const sessions = row?.sessions ?? 0;
      return {
        variantId: variant.id,
        key: variant.key,
        label: variant.label,
        isControl: variant.isControl,
        sessions,
        avgActiveSeconds: row ? Math.round((row.avgActiveMs / 1000) * 10) / 10 : 0,
        avgScrollDepthPct: row ? Math.round(row.avgMaxScrollPct * 10) / 10 : 0,
        clickRate: sessions > 0 && row ? Math.round((row.clicks / sessions) * 1000) / 10 : 0,
        rageClicks: row?.rageClicks ?? 0,
      };
    });

    return reply.send({
      test: { id: test.id, name: test.name, status: test.status, startedAt: test.startedAt },
      results,
      note: "Basic aggregates only. Statistical significance (Bayesian winner detection) ships in phase 2.",
    });
  });
}
