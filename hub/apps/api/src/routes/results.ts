import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getHeatmap, getResults } from "@tcw/core";
import { requireAuth } from "../lib/session.js";

/** Simple per-variant aggregates. Significance and the winner verdict come from /api/tests/:id/stats. */
export async function resultRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/tests/:id/results", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const data = await getResults(id);
    if (!data) return reply.code(404).send({ error: "test_not_found" });
    return reply.send({ ...data, note: "Basic aggregates. Significance and the winner verdict come from /api/tests/:id/stats." });
  });

  /** Top elements per heat layer plus the scroll drop-off. Filters: ?variant=b&device=mobile. */
  app.get("/api/tests/:id/heatmap", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const q = z.object({ variant: z.string().min(1).max(32).optional(), device: z.enum(["desktop", "tablet", "mobile"]).optional() }).parse(request.query);
    const result = await getHeatmap(id, { variantKey: q.variant, device: q.device });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send(result.data);
  });
}
