import { Queue, Worker } from "bullmq";
import { STATS_QUEUE } from "@tcw/shared";
import { env } from "./env.js";
import { recomputeAllLive, recomputeTest } from "./stats-job.js";


const HOURLY_MS = 60 * 60 * 1000;

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

  new Worker(
    STATS_QUEUE,
    async (job) => {
      if (job.name === "recompute-test") {
        await recomputeTest(String(job.data.testId));
      } else {
        const n = await recomputeAllLive();
        // eslint-disable-next-line no-console
        console.log(`[worker] hourly stats recompute finished for ${n} test(s)`);
      }
    },
    { connection: redisConnection() },
  );
}
