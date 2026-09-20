import type { Redis } from "ioredis";

/** "done": handled (or hopeless), remove it from the stream. "retry": leave it pending so it is tried again. */
export type Outcome = "done" | "retry";

export const MAX_ATTEMPTS = 5;
export const IDLE_MS = 60_000;

type StreamRedis = Pick<Redis, "xautoclaim" | "xpending" | "xack" | "xdel" | "xadd">;

export interface RecoveryOptions {
  stream: string;
  group: string;
  /** Claimed entries move to this consumer while they are retried. */
  consumer: string;
  handle: (id: string, fields: string[]) => Promise<Outcome>;
  idleMs?: number;
  maxAttempts?: number;
}

export interface RecoveryResult {
  done: number;
  retried: number;
  deadLettered: number;
}

/** XACK only marks an entry handled; it stays in the stream until deleted, so the stream would grow for ever. */
export async function ackAndDelete(redis: Pick<Redis, "xack" | "xdel">, stream: string, group: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await redis.xack(stream, group, ...ids);
  await redis.xdel(stream, ...ids);
}

/**
 * Entries that were delivered but never acknowledged: a worker crashed mid-batch, or processing failed
 * (a database blip). Claim everything idle for `idleMs`, from any consumer (a restarted worker has a new
 * name, so the old one's entries would otherwise be stuck), and try each again. After `maxAttempts`
 * deliveries an entry is moved to `<stream>:dead` for a human to look at, so one bad event cannot loop
 * for ever.
 */
export async function reclaimStale(redis: StreamRedis, o: RecoveryOptions): Promise<RecoveryResult> {
  const idleMs = o.idleMs ?? IDLE_MS;
  const maxAttempts = o.maxAttempts ?? MAX_ATTEMPTS;
  const result: RecoveryResult = { done: 0, retried: 0, deadLettered: 0 };

  let cursor = "0-0";
  for (let page = 0; page < 50; page++) {
    let reply: unknown;
    try {
      reply = await redis.xautoclaim(o.stream, o.group, o.consumer, idleMs, cursor, "COUNT", 100);
    } catch {
      return result; // the group may not exist yet on a brand-new stream: nothing to recover
    }
    const [next, entries] = reply as [string, Array<[string, string[]]>];

    const finished: string[] = [];
    for (const [id, fields] of entries ?? []) {
      const pending = (await redis.xpending(o.stream, o.group, id, id, 1)) as Array<[string, string, number, number]>;
      const deliveries = Number(pending?.[0]?.[3] ?? 1);

      if (deliveries > maxAttempts) {
        const payloadAt = fields.indexOf("payload");
        await redis.xadd(`${o.stream}:dead`, "*", "id", id, "payload", payloadAt >= 0 ? fields[payloadAt + 1] : "", "reason", `gave up after ${deliveries - 1} attempts`);
        finished.push(id);
        result.deadLettered++;
        continue;
      }
      if ((await o.handle(id, fields)) === "done") {
        finished.push(id);
        result.done++;
      } else {
        result.retried++;
      }
    }
    await ackAndDelete(redis, o.stream, o.group, finished);

    if (next === "0-0" || next === cursor) break;
    cursor = next;
  }
  return result;
}
