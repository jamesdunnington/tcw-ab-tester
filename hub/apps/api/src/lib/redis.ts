import { Redis } from "ioredis";
import { env } from "../env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("error", (err: Error) => {
  // eslint-disable-next-line no-console
  console.error("[redis] connection error", err.message);
});

export function runtimeConfigCacheKey(siteId: string): string {
  return `tcw:config:${siteId}`;
}
