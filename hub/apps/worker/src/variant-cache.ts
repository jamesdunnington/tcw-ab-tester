import { eq, and } from "drizzle-orm";
import { variants, tests } from "@tcw/db";
import { db } from "./db.js";

/**
 * Tiny in-process cache mapping (testId, variantKey) -> variant id + test
 * type. Bounded TTL so a variant added/renamed while the worker is already
 * running is picked up within a minute, without a DB round trip per event.
 */
const CACHE_TTL_MS = 60_000;

export interface ResolvedVariant {
  id: string;
  testType: "page" | "element";
}

const cache = new Map<string, { value: ResolvedVariant; expiresAt: number }>();

export async function resolveVariant(testId: string, variantKey: string): Promise<ResolvedVariant | null> {
  const cacheKey = `${testId}:${variantKey}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  const [row] = await db
    .select({ id: variants.id, testType: tests.type })
    .from(variants)
    .innerJoin(tests, eq(tests.id, variants.testId))
    .where(and(eq(variants.testId, testId), eq(variants.key, variantKey)))
    .limit(1);

  if (!row) return null;

  cache.set(cacheKey, { value: row, expiresAt: Date.now() + CACHE_TTL_MS });
  return row;
}
