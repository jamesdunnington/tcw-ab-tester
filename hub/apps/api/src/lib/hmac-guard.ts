import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyRequest } from "@tcw/shared";
import { redis } from "./redis.js";
import { db } from "../db/client.js";
import { sites } from "@tcw/db";
import { eq } from "drizzle-orm";
import { decryptSecret } from "./crypto.js";

export type SiteRow = typeof sites.$inferSelect;

declare module "fastify" {
  interface FastifyRequest {
    site?: SiteRow;
    rawBody?: string;
  }
}

/**
 * Verifies a WordPress -> hub signed request (see @tcw/shared hmac.ts for
 * the algorithm, and wp-plugin/tcw-ab-tester/includes/class-hub-client.php
 * for the PHP side that produces these headers).
 *
 * On success, attaches `request.site` (the resolved site row) so route
 * handlers don't need to re-look it up.
 */
export async function verifyWpSignature(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const siteKey = request.headers["x-tcw-site-key"];
  const timestamp = request.headers["x-tcw-timestamp"];
  const nonce = request.headers["x-tcw-nonce"];
  const signature = request.headers["x-tcw-signature"];

  if (
    typeof siteKey !== "string" ||
    typeof timestamp !== "string" ||
    typeof nonce !== "string" ||
    typeof signature !== "string"
  ) {
    return reply.code(401).send({ error: "missing_signature_headers" });
  }

  const [site] = await db.select().from(sites).where(eq(sites.siteKey, siteKey)).limit(1);
  if (!site) {
    return reply.code(401).send({ error: "unknown_site" });
  }

  // Replay guard: a nonce may only be used once within the signature skew window.
  const nonceKey = `tcw:nonce:${site.id}:${nonce}`;
  const firstUse = await redis.set(nonceKey, "1", "EX", 300, "NX");
  if (firstUse !== "OK") {
    return reply.code(401).send({ error: "replayed_nonce" });
  }

  const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});
  const secret = decryptSecret(site.secretEncrypted);

  const result = verifyRequest({
    method: request.method,
    path: request.url.split("?")[0] ?? request.url,
    body: rawBody,
    secret,
    timestamp,
    nonce,
    signature,
  });

  if (!result.ok) {
    return reply.code(401).send({ error: result.reason });
  }

  request.site = site;
  db.update(sites).set({ lastSeenAt: new Date() }).where(eq(sites.id, site.id)).then(
    () => undefined,
    () => undefined,
  );
}
