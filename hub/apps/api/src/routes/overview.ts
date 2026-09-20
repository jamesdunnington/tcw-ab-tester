import type { FastifyInstance } from "fastify";
import { getOverview } from "@tcw/core";
import { requireAuth } from "../lib/session.js";

/** The dashboard's landing page: every live test and every test waiting on a decision, across all sites. */
export async function overviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/overview", async (_request, reply) => reply.send(await getOverview()));
}
