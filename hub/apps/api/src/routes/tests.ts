import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createPageTestSchema, createElementTestSchema, changeOpsSchema } from "@tcw/shared";
import { addPageVariant, createElementTest, createPageTest, saveVariantOps, startTest, stopTest, type ServiceResult } from "@tcw/core";
import { tests, variants } from "@tcw/db";
import { db } from "../db/client.js";
import { requireAuth } from "../lib/session.js";

/** Maps a core service outcome to HTTP. Business rules live in @tcw/core so the MCP connector shares them. */
function send<T>(reply: FastifyReply, result: ServiceResult<T>, successStatus = 200) {
  if (!result.ok) return reply.code(result.status).send({ error: result.error, ...(result.detail && typeof result.detail === "object" ? result.detail : {}) });
  return reply.code(successStatus).send(result.data);
}

export async function testRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/tests", async (request, reply) => {
    const { siteId } = z.object({ siteId: z.string().uuid().optional() }).parse(request.query);
    const rows = siteId ? await db.select().from(tests).where(eq(tests.siteId, siteId)) : await db.select().from(tests);
    return reply.send({ tests: rows });
  });

  app.get("/api/tests/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "not_found" });
    const variantRows = await db.select().from(variants).where(eq(variants.testId, id));
    return reply.send({ test, variants: variantRows });
  });

  // Step 1: create the test + control variant "a". WP is queried live for the post's real
  // title/type/permalink, so the dashboard only needs a post ID.
  app.post("/api/tests", async (request, reply) => send(reply, await createPageTest(createPageTestSchema.parse(request.body)), 201));

  // Element tests: no variant post is duplicated; variant "b" carries change ops instead.
  app.post("/api/element-tests", async (request, reply) => send(reply, await createElementTest(createElementTestSchema.parse(request.body)), 201));

  // Replace a variant's change ops (dashboard path; the editor uses /editor/ops with its token).
  app.put("/api/tests/:id/variants/:key/ops", async (request, reply) => {
    const { id, key } = z.object({ id: z.string().uuid(), key: z.string().min(1).max(32) }).parse(request.params);
    const { ops } = z.object({ ops: changeOpsSchema }).parse(request.body);
    const saved = await saveVariantOps(id, key, ops);
    if (!saved.ok) return reply.code(saved.status).send({ error: saved.error });
    return reply.send({ variant: saved.variant });
  });

  // Step 2: ask WP to duplicate the original post into a "b" variant.
  app.post("/api/tests/:id/variants", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { label } = z.object({ label: z.string().min(1).max(160).default("B (variant)") }).parse(request.body ?? {});
    return send(reply, await addPageVariant(id, label), 201);
  });

  // Step 3: go live.
  app.post("/api/tests/:id/start", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return send(reply, await startTest(id));
  });

  app.post("/api/tests/:id/stop", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return send(reply, await stopTest(id));
  });
}
