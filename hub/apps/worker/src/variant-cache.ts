import { eq, and } from "drizzle-orm";
import { variants } from "@tcw/db";
import { db } from "./db.js";

/**
 * Tiny in-process cache mapping (testId, variantKey) -> variantId. Bounded
 * TTL so a variant added/renamed while the worker is already running is
 * picked up within a minute, without a DB round trip per event.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { id: string; expiresAt: number }>();

export async function resolveVariantId(testId: string, variantKey: string): Promise<string | null> {
  const cacheKey = `${testId}:${variantKey}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.id;
  }

  const [row] = await db
    .select({ id: variants.id })
    .from(variants)
    .where(and(eq(variants.testId, testId), eq(variants.key, variantKey)))
    .limit(1);

  if (!row) return null;

  cache.set(cacheKey, { id: row.id, expiresAt: Date.now() + CACHE_TTL_MS });
  return row.id;
}
