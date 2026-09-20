import { Queue, Worker } from "bullmq";
import { STATS_QUEUE } from "@tcw/shared";
import { env } from "./env.js";
import { db } from "./db.js";
import { purgeOldData } from "./retention.js";
import { recomputeAllLive, recomputeTest } from "./stats-job.js";


const HOURLY_MS = 60 * 60 * 1000;
const DAILY_MS = 24 * HOURLY_MS;

function redisConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null as null, // required by BullMQ for its blocking connections
  };
}

/**
 * Recurring jobs (BullMQ, as planned in docs/PLAN.md section 1): recompute
 * every live test's statistics hourly. A "recompute-test" job can also be
 * enqueued on demand (the dashboard's "Recompute now").
 */
export async function startStatsScheduler(): Promise<void> {
  const queue = new Queue(STATS_QUEUE, { connection: redisConnection() });
  await queue.upsertJobScheduler("hourly-recompute", { every: HOURLY_MS }, { name: "recompute-all" });
  await queue.upsertJobScheduler("daily-retention", { every: DAILY_MS }, { name: "retention" });

  new Worker(
    STATS_QUEUE,
    async (job) => {
      if (job.name === "recompute-test") {
        await recomputeTest(String(job.data.testId));
      } else if (job.name === "retention") {
        const r = await purgeOldData(db, { eventRetentionDays: env.EVENT_RETENTION_DAYS, fullSnapshotDays: env.SNAPSHOT_FULL_DAYS });
        // eslint-disable-next-line no-console
        console.log("[worker] retention finished:", JSON.stringify(r));
      } else {
        const n = await recomputeAllLive();
        // eslint-disable-next-line no-console
        console.log(`[worker] hourly stats recompute finished for ${n} test(s)`);
      }
    },
    { connection: redisConnection() },
  );
}
