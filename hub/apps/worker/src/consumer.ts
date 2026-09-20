import { Redis } from "ioredis";
import { INGEST_STREAM_KEY, INGEST_CONSUMER_GROUP, queuedTrackerEventSchema } from "@tcw/shared";
import { env } from "./env.js";
import { processEvent } from "./process-event.js";

const BLOCK_MS = 5000;
const BATCH_SIZE = 100;
const consumerName = `worker-${process.pid}`;

/**
 * Consumes the ingest stream the API's /ingest route writes to (Redis
 * Streams, not BullMQ — see hub/apps/worker/README.md for why). A
 * consumer group gives at-least-once delivery: unacked entries survive a
 * worker crash/restart and get reclaimed below.
 */
export async function runConsumer(): Promise<void> {
  const redis = new Redis(env.REDIS_URL);

  try {
    await redis.xgroup("CREATE", INGEST_STREAM_KEY, INGEST_CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) throw err;
  }

  // eslint-disable-next-line no-console
  console.log(`[worker] consuming ${INGEST_STREAM_KEY} as ${consumerName}`);

  // Reclaim anything left idle by a crashed worker before joining the live tail.
  await reclaimStale(redis);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await redis.xreadgroup(
      "GROUP",
      INGEST_CONSUMER_GROUP,
      consumerName,
      "COUNT",
      BATCH_SIZE,
      "BLOCK",
      BLOCK_MS,
      "STREAMS",
      INGEST_STREAM_KEY,
      ">",
    );

    if (!response) continue;

    for (const [, entries] of response as Array<[string, Array<[string, string[]]>]>) {
      const ackIds: string[] = [];
      for (const [id, fields] of entries) {
        await handleEntry(id, fields);
        ackIds.push(id);
      }
      if (ackIds.length > 0) {
        await redis.xack(INGEST_STREAM_KEY, INGEST_CONSUMER_GROUP, ...ackIds);
        // XACK only marks an entry as handled; it stays in the stream. Delete it too, or the stream
        // (and Redis memory) grows for ever.
        await redis.xdel(INGEST_STREAM_KEY, ...ackIds);
      }
    }
  }
}

async function handleEntry(id: string, fields: string[]): Promise<void> {
  const payloadIndex = fields.indexOf("payload");
  const raw = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;
  if (!raw) return;

  try {
    const parsed = queuedTrackerEventSchema.parse(JSON.parse(raw));
    await processEvent(parsed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] failed to process stream entry ${id}:`, err);
    // Still ack'd by the caller — a malformed entry would otherwise block
    // the stream forever. Phase 2: route to a dead-letter stream instead.
  }
}

async function reclaimStale(redis: Redis): Promise<void> {
  const IDLE_MS = 60_000;
  try {
    await redis.xautoclaim(INGEST_STREAM_KEY, INGEST_CONSUMER_GROUP, consumerName, IDLE_MS, "0");
  } catch {
    // Group may not exist yet on a brand-new stream — harmless.
  }
}
