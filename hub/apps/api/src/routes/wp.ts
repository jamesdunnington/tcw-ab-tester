import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { sites } from "@tcw/db";
import { verifyWpSignature } from "../lib/hmac-guard.js";
import { buildRuntimeConfig } from "@tcw/core";

const heartbeatSchema = z.object({
  wpVersion: z.string().max(40).optional(),
  pluginVersion: z.string().max(40).optional(),
});

/** Endpoints the WordPress plugin calls INTO the hub. All signed (verifyWpSignature). */
export async function wpRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", verifyWpSignature);

  app.post("/wp/v1/heartbeat", async (request, reply) => {
    const body = heartbeatSchema.parse(request.body);
    const site = request.site!;
    await db
      .update(sites)
      .set({
        wpVersion: body.wpVersion ?? site.wpVersion,
        pluginVersion: body.pluginVersion ?? site.pluginVersion,
        lastSeenAt: new Date(),
      })
      .where(eq(sites.id, site.id));
    return reply.send({ ok: true, siteId: site.id, displayName: site.displayName });
  });

  // Fallback resync path (WP-Cron) in case a config push failed to reach
  // the site earlier — see lib/wp-client.ts pushRuntimeConfig for the
  // primary, real-time path.
  app.get("/wp/v1/config", async (request, reply) => {
    const site = request.site!;
    const testEntries = await buildRuntimeConfig(site.id);
    return reply.send({ siteId: site.id, generatedAt: new Date().toISOString(), tests: testEntries });
  });
}
