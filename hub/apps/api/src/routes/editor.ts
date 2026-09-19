import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createEditorLink, createHeatmapLink } from "@tcw/core";
import { requireAuth } from "../lib/session.js";

/**
 * Mints the link that opens the visual editor on the live WordPress page
 * (docs/PLAN.md section 7). The token is signed with the site secret, so the
 * plugin can verify it without calling the hub.
 */
export async function editorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/tests/:id/variants/:key/editor-link", async (request, reply) => {
    const { id, key } = z.object({ id: z.string().uuid(), key: z.string().min(1).max(32) }).parse(request.params);
    const result = await createEditorLink(id, key);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send(result.data);
  });

  // Opens the read-only heatmap overlay on the live page (variantKey defaults to the control).
  app.post("/api/tests/:id/heatmap-link", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { variantKey } = z.object({ variantKey: z.string().min(1).max(32).optional() }).parse(request.body ?? {});
    const result = await createHeatmapLink(id, variantKey);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send(result.data);
  });
}
