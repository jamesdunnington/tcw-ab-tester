import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ingestBatchSchema, INGEST_STREAM_KEY } from "@tcw/shared";
import { db } from "../db/client.js";
import { sites } from "@tcw/db";
import { redis } from "../lib/redis.js";

const RATE_LIMIT_WINDOW_SECONDS = 300;
const RATE_LIMIT_MAX_REQUESTS = 300; // ~1 batch every second, generous for a real visitor

/**
 * Public endpoint the browser tracker (packages/tracker) posts to directly.
 * No HMAC here (a public site key only, never a secret, ever reaches the
 * browser) — protected instead by origin checking, payload validation, and
 * per-IP rate limiting.
 *
 * Site key may arrive as the x-tcw-site-key header (periodic flushes, via
 * fetch+keepalive, which supports custom headers) OR as an "sk" query param
 * (the final unload flush, via navigator.sendBeacon, which cannot set
 * headers at all - see packages/tracker/src/tracker.ts flush()). The header
 * wins if both are somehow present.
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/ingest", async (request, reply) => {
    const headerKey = request.headers["x-tcw-site-key"];
    const queryKey = (request.query as Record<string, unknown> | undefined)?.sk;
    const siteKey = typeof headerKey === "string" ? headerKey : typeof queryKey === "string" ? queryKey : undefined;
    if (!siteKey) {
      return reply.code(400).send({ error: "missing_site_key" });
    }

    const ip = request.ip ?? "unknown";
    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const rateLimitKey = `tcw:ratelimit:ingest:${ipHash}`;
    const requestCount = await redis.incr(rateLimitKey);
    if (requestCount === 1) {
      await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
    }
    if (requestCount > RATE_LIMIT_MAX_REQUESTS) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    const [site] = await db.select().from(sites).where(eq(sites.siteKey, siteKey)).limit(1);
    if (!site) {
      return reply.code(404).send({ error: "unknown_site" });
    }

    // Lightweight origin check. Not a strong boundary (Origin/Referer are
    // client-supplied) but cheap to add and filters most drive-by noise;
    // the real trust boundary is that this endpoint can only ever write
    // low-value analytics events, never mutate a test or a WP post.
    const origin = request.headers.origin ?? request.headers.referer ?? "";
    if (origin && !origin.includes(site.domain.replace(/^https?:\/\//, ""))) {
      return reply.code(403).send({ error: "origin_mismatch" });
    }

    const parsed = ingestBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    }

    // No tracking consent: acknowledge receipt but store nothing. (Phase 2
    // refinement: still increment a consent-blind counter for the Sample
    // Ratio Mismatch check per docs/PLAN.md section 3.)
    if (!parsed.data.consent) {
      return reply.code(202).send({ ok: true, stored: 0 });
    }

    // siteId is never client-supplied (see @tcw/shared TrackerEventPayload) —
    // it's stamped here from the site the signature/site-key lookup above
    // already resolved, which is the only trustworthy source for it.
    const pipeline = redis.pipeline();
    for (const event of parsed.data.events) {
      const queued = { ...event, siteId: site.id };
      pipeline.xadd(INGEST_STREAM_KEY, "*", "payload", JSON.stringify(queued));
    }
    await pipeline.exec();

    return reply.code(202).send({ ok: true, stored: parsed.data.events.length });
  });
}
