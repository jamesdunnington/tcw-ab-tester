import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { generateSiteCredentials } from "@tcw/shared";
import { db } from "../db/client.js";
import { sites } from "@tcw/db";
import { encryptSecret } from "@tcw/core";
import { requireAuth } from "../lib/session.js";

const createSiteSchema = z.object({
  domain: z.string().min(3).max(255),
  displayName: z.string().min(1).max(120),
});

function publicSite(site: typeof sites.$inferSelect) {
  const { secretEncrypted, ...rest } = site;
  return rest;
}

export async function siteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/api/sites", async (_request, reply) => {
    const rows = await db.select().from(sites).orderBy(sites.createdAt);
    return reply.send({ sites: rows.map(publicSite) });
  });

  app.get("/api/sites/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [site] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
    if (!site) return reply.code(404).send({ error: "not_found" });
    return reply.send({ site: publicSite(site) });
  });

  // Credentials are returned in full exactly once, here. The WP plugin admin
  // screen is where they get pasted in; the hub never displays the raw
  // secret again after this response.
  app.post("/api/sites", async (request, reply) => {
    const body = createSiteSchema.parse(request.body);
    const { siteKey, siteSecret } = generateSiteCredentials();
    const [site] = await db
      .insert(sites)
      .values({
        domain: body.domain,
        displayName: body.displayName,
        siteKey,
        secretEncrypted: encryptSecret(siteSecret),
      })
      .returning();

    return reply.code(201).send({
      site: publicSite(site),
      credentials: { siteKey, siteSecret },
    });
  });

  app.post("/api/sites/:id/rotate-secret", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [existing] = await db.select().from(sites).where(eq(sites.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const { siteKey, siteSecret } = generateSiteCredentials();
    const [site] = await db
      .update(sites)
      .set({ siteKey, secretEncrypted: encryptSecret(siteSecret) })
      .where(eq(sites.id, id))
      .returning();

    return reply.send({ site: publicSite(site), credentials: { siteKey, siteSecret } });
  });
}
