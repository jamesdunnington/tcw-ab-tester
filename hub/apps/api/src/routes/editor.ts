import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createEditorLink } from "@tcw/core";
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
}
