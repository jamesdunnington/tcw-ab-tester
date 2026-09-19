import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createPageTestSchema, createElementTestSchema, changeOpsSchema } from "@tcw/shared";
import { db } from "../db/client.js";
import { sites, tests, variants } from "@tcw/db";
import { requireAuth } from "../lib/session.js";
import { fetchPostInfo, requestVariantDuplicate, pushRuntimeConfig } from "../lib/wp-client.js";
import { buildRuntimeConfig } from "../lib/config-builder.js";

async function getSiteOr404(siteId: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1);
  if (!site) {
    reply.code(404).send({ error: "site_not_found" });
    return null;
  }
  return site;
}

export async function testRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/tests", async (request, reply) => {
    const { siteId } = z.object({ siteId: z.string().uuid().optional() }).parse(request.query);
    const rows = siteId
      ? await db.select().from(tests).where(eq(tests.siteId, siteId))
      : await db.select().from(tests);
    return reply.send({ tests: rows });
  });

  app.get("/api/tests/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "not_found" });
    const variantRows = await db.select().from(variants).where(eq(variants.testId, id));
    return reply.send({ test, variants: variantRows });
  });

  // Step 1: create the test + control variant "a". WP is queried live for
  // the post's real title/type/permalink so the dashboard only needs a
  // post ID — see lib/wp-client.ts fetchPostInfo.
  app.post("/api/tests", async (request, reply) => {
    const body = createPageTestSchema.parse(request.body);
    const site = await getSiteOr404(body.siteId, reply);
    if (!site) return;

    const postInfo = await fetchPostInfo(site, body.wpPostId);

    const [test] = await db
      .insert(tests)
      .values({
        siteId: site.id,
        name: body.name ?? postInfo.title,
        type: "page",
        status: "draft",
        wpPostId: postInfo.id,
        wpPostType: postInfo.type,
        wpPermalink: postInfo.permalink,
        wordCount: postInfo.wordCount,
        trafficSplit: body.trafficSplit,
        minSampleSize: body.minSampleSize,
        minRunDays: body.minRunDays,
        confidenceThreshold: String(body.confidenceThreshold),
      })
      .returning();

    const [controlVariant] = await db
      .insert(variants)
      .values({
        testId: test.id,
        key: "a",
        label: "A (original)",
        isControl: true,
        trafficWeight: 100 - body.trafficSplit,
      })
      .returning();

    return reply.code(201).send({ test, variants: [controlVariant] });
  });

  // Element tests: no variant post is duplicated; variant "b" carries change ops instead.
  app.post("/api/element-tests", async (request, reply) => {
    const body = createElementTestSchema.parse(request.body);
    const site = await getSiteOr404(body.siteId, reply);
    if (!site) return;
    const postInfo = await fetchPostInfo(site, body.wpPostId);

    const [test] = await db
      .insert(tests)
      .values({
        siteId: site.id,
        name: body.name ?? postInfo.title,
        type: "element",
        status: "draft",
        wpPostId: postInfo.id,
        wpPostType: postInfo.type,
        wpPermalink: postInfo.permalink,
        wordCount: postInfo.wordCount,
        trafficSplit: body.trafficSplit,
        minSampleSize: body.minSampleSize,
        minRunDays: body.minRunDays,
        confidenceThreshold: String(body.confidenceThreshold),
      })
      .returning();

    const created = await db
      .insert(variants)
      .values([
        { testId: test.id, key: "a", label: "A (original)", isControl: true, trafficWeight: 100 - body.trafficSplit, changeOps: [] },
        { testId: test.id, key: "b", label: "B (variant)", isControl: false, trafficWeight: body.trafficSplit, changeOps: [] },
      ])
      .returning();

    return reply.code(201).send({ test, variants: created });
  });

  // Replace a variant's change ops (what the visual editor saves).
  app.put("/api/tests/:id/variants/:key/ops", async (request, reply) => {
    const { id, key } = z.object({ id: z.string().uuid(), key: z.string().min(1).max(32) }).parse(request.params);
    const { ops } = z.object({ ops: changeOpsSchema }).parse(request.body);

    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });
    if (test.type !== "element") return reply.code(409).send({ error: "not_an_element_test" });

    const [variant] = await db
      .update(variants)
      .set({ changeOps: ops })
      .where(and(eq(variants.testId, id), eq(variants.key, key)))
      .returning();
    if (!variant) return reply.code(404).send({ error: "variant_not_found" });

    // A live test picks the edit up right away.
    if (test.status === "running") {
      const site = await getSiteOr404(test.siteId, reply);
      if (!site) return;
      await pushRuntimeConfig(site, await buildRuntimeConfig(site.id));
    }
    return reply.send({ variant });
  });

  // Step 2: ask WP to duplicate the original post into a "b" variant.
  app.post("/api/tests/:id/variants", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { label } = z.object({ label: z.string().min(1).max(160).default("B (variant)") }).parse(request.body ?? {});

    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });
    const site = await getSiteOr404(test.siteId, reply);
    if (!site) return;

    const existingVariants = await db.select().from(variants).where(eq(variants.testId, id));
    const nextKey = String.fromCharCode(97 + existingVariants.length); // a, b, c, ...

    const duplicate = await requestVariantDuplicate(site, {
      testId: test.id,
      variantKey: nextKey,
      sourcePostId: test.wpPostId,
      label,
    });

    const [variant] = await db
      .insert(variants)
      .values({
        testId: test.id,
        key: nextKey,
        label,
        isControl: false,
        trafficWeight: test.trafficSplit,
        wpPostId: duplicate.variantWpPostId,
        previewUrl: duplicate.previewUrl,
      })
      .returning();

    return reply.code(201).send({ variant });
  });

  // Step 3: go live. Pushes the config to WP so the assignment script is
  // injected on the next page load (no WP-Cron delay needed).
  app.post("/api/tests/:id/start", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });

    const variantRows = await db.select().from(variants).where(eq(variants.testId, id));
    if (variantRows.length < 2) {
      return reply.code(409).send({ error: "needs_at_least_two_variants" });
    }
    if (test.type === "element") {
      const hasEdit = variantRows.some((v) => !v.isControl && changeOpsSchema.catch([]).parse(v.changeOps ?? []).some((o) => o.op !== "goal"));
      if (!hasEdit) return reply.code(409).send({ error: "variant_has_no_changes" });
    }

    const [updated] = await db
      .update(tests)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(tests.id, id))
      .returning();

    const site = await getSiteOr404(test.siteId, reply);
    if (!site) return;
    const config = await buildRuntimeConfig(site.id);
    await pushRuntimeConfig(site, config);

    return reply.send({ test: updated });
  });

  app.post("/api/tests/:id/stop", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });

    const [updated] = await db
      .update(tests)
      .set({ status: "inconclusive", endedAt: new Date() })
      .where(eq(tests.id, id))
      .returning();

    const site = await getSiteOr404(test.siteId, reply);
    if (!site) return;
    const config = await buildRuntimeConfig(site.id);
    await pushRuntimeConfig(site, config);

    return reply.send({ test: updated });
  });
}
