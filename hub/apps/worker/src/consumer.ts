import { Redis } from "ioredis";
import { INGEST_STREAM_KEY, INGEST_CONSUMER_GROUP, queuedTrackerEventSchema } from "@tcw/shared";
import { env } from "./env.js";
import { processEvent } from "./process-event.js";
import { ackAndDelete, reclaimStale, type Outcome } from "./stream-recovery.js";

const BLOCK_MS = 5000;
const BATCH_SIZE = 100;
const RECLAIM_EVERY_MS = 30_000;
const consumerName = `worker-${process.pid}`;

/**
 * Consumes the ingest stream the API's /ingest route writes to (Redis
 * Streams, not BullMQ — see hub/apps/worker/README.md for why). A
 * consumer group gives at-least-once delivery: an entry is only removed once
 * it was handled, so a crash or a database outage leaves it pending and
 * stream-recovery.ts retries it (and parks it in a dead-letter stream after
 * repeated failures).
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

  const recovery = { stream: INGEST_STREAM_KEY, group: INGEST_CONSUMER_GROUP, consumer: consumerName, handle: handleEntry };
  let lastReclaim = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // On start (anything a crashed worker left behind) and then regularly (entries whose processing failed).
    if (Date.now() - lastReclaim >= RECLAIM_EVERY_MS) {
      lastReclaim = Date.now();
      const r = await reclaimStale(redis, recovery);
      if (r.done + r.retried + r.deadLettered > 0) {
        // eslint-disable-next-line no-console
        console.log(`[worker] recovered ${r.done}, will retry ${r.retried}, gave up on ${r.deadLettered}`);
      }
    }
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
        if ((await handleEntry(id, fields)) === "done") ackIds.push(id);
      }
      await ackAndDelete(redis, INGEST_STREAM_KEY, INGEST_CONSUMER_GROUP, ackIds);
    }
  }
}

/**
 * A malformed entry can never succeed, so it is dropped ("done"). A failure while storing it (the database
 * being down) is worth another try, so it stays pending ("retry") instead of being lost.
 */
async function handleEntry(id: string, fields: string[]): Promise<Outcome> {
  const payloadIndex = fields.indexOf("payload");
  const raw = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;
  if (!raw) return "done";

  let parsed;
  try {
    parsed = queuedTrackerEventSchema.parse(JSON.parse(raw));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] dropping malformed stream entry ${id}:`, err);
    return "done";
  }

  try {
    await processEvent(parsed);
    return "done";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] could not store stream entry ${id}, will retry:`, err);
    return "retry";
  }
}
