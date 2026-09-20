import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { auditLog } from "@tcw/db";
import { applyLibraryItem, describeLibraryItem, getDb, getLibraryItem, listLibrary, setLibraryTags } from "@tcw/core";
import { requireAuth } from "../lib/session.js";

/** The cross-site library (docs/PLAN.md section 10): decided tests kept for reuse on other sites. */
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/library", async (request, reply) => {
    const q = z
      .object({
        type: z.enum(["page", "element"]).optional(),
        tag: z.string().max(40).optional(),
        q: z.string().max(120).optional(),
        siteId: z.string().uuid().optional(),
        minLift: z.coerce.number().optional(),
      })
      .parse(request.query);
    return reply.send({ items: await listLibrary({ type: q.type, tag: q.tag, q: q.q, siteId: q.siteId, minLiftPct: q.minLift }) });
  });

  app.get("/api/library/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await getLibraryItem(id);
    if (!item) return reply.code(404).send({ error: "library_item_not_found" });
    return reply.send(describeLibraryItem(item));
  });

  app.put("/api/library/:id/tags", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { tags } = z.object({ tags: z.array(z.string().max(40)).max(30) }).parse(request.body);
    const result = await setLibraryTags(id, tags);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send(result.data);
  });

  app.post("/api/library/:id/apply", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ targetSiteId: z.string().uuid(), wpPostId: z.number().int().positive().optional(), mode: z.enum(["test", "permanent"]).optional() })
      .parse(request.body);
    let result;
    try {
      result = await applyLibraryItem(id, body);
    } catch (err) {
      return reply.code(502).send({ error: "target_site_unreachable", message: err instanceof Error ? err.message : String(err) });
    }
    if (!result.ok) return reply.code(result.status).send({ error: result.error, ...(result.detail && typeof result.detail === "object" ? result.detail : {}) });
    await getDb().insert(auditLog).values({ actor: request.currentUser!.email, action: "library.applied", target: id, meta: { ...body, kind: result.data.kind } });
    return reply.send(result.data);
  });
}

