import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getResults } from "@tcw/core";
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
}
