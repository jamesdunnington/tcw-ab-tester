import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { applyDecision, getStats, restoreOriginal } from "@tcw/core";
import { decisionInputSchema, RECOMPUTE_TEST_JOB } from "@tcw/shared";
import { requireAuth } from "../lib/session.js";
import { statsQueue } from "../lib/queue.js";

export async function decisionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/tests/:id/stats", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.send(await getStats(id));
  });

  app.post("/api/tests/:id/recompute", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await statsQueue.add(RECOMPUTE_TEST_JOB, { testId: id });
    return reply.code(202).send({ queued: true });
  });

  // The winner flow (docs/PLAN.md section 6) lives in @tcw/core so the MCP connector runs the very same code.
  app.post("/api/tests/:id/decision", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = decisionInputSchema.parse(request.body);
    const user = request.currentUser!;

    const result = await applyDecision(id, body, { userId: user.id, label: user.email });
    if (!result.ok) {
      const detail = result.detail;
      if (result.error === "finalize_failed") return reply.code(result.status).send({ error: result.error, message: detail });
      return reply.code(result.status).send({ error: result.error, ...(detail && typeof detail === "object" ? detail : {}) });
    }
    return reply.send({ ok: true, manifest: result.data.manifest });
  });

  // Puts the original page back after a winner replaced it (WordPress keeps the current version as a revision).
  app.post("/api/tests/:id/restore-original", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const user = request.currentUser!;
    const result = await restoreOriginal(id, { userId: user.id, label: user.email });
    if (!result.ok) {
      const detail = result.detail;
      if (result.error === "restore_failed") return reply.code(result.status).send({ error: result.error, message: detail });
      return reply.code(result.status).send({ error: result.error });
    }
    return reply.send({ ok: true, revisionSaved: result.data.revisionSaved });
  });
}
