import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { signEditorToken } from "@tcw/shared";
import { db } from "../db/client.js";
import { sites, tests, variants } from "@tcw/db";
import { requireAuth } from "../lib/session.js";
import { decryptSecret } from "../lib/crypto.js";

/**
 * Mints the link that opens the visual editor on the live WordPress page
 * (docs/PLAN.md section 7). The token is signed with the site secret, so the
 * plugin can verify it without calling the hub.
 */
export async function editorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/api/tests/:id/variants/:key/editor-link", async (request, reply) => {
    const { id, key } = z.object({ id: z.string().uuid(), key: z.string().min(1).max(32) }).parse(request.params);

    const [test] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!test) return reply.code(404).send({ error: "test_not_found" });
    if (test.type !== "element") return reply.code(409).send({ error: "not_an_element_test" });

    const [variant] = await db
      .select()
      .from(variants)
      .where(and(eq(variants.testId, id), eq(variants.key, key)))
      .limit(1);
    if (!variant) return reply.code(404).send({ error: "variant_not_found" });
    if (variant.isControl) return reply.code(409).send({ error: "control_is_not_editable" });

    const [site] = await db.select().from(sites).where(eq(sites.id, test.siteId)).limit(1);
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    const token = signEditorToken({
      siteKey: site.siteKey,
      testId: test.id,
      variantKey: variant.key,
      secret: decryptSecret(site.secretEncrypted),
    });

    const url = new URL(test.wpPermalink);
    url.searchParams.set("tcwab_editor", token);
    return reply.send({ url: url.toString() });
  });
}
