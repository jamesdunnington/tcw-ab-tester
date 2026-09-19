import { Queue } from "bullmq";
import { STATS_QUEUE } from "@tcw/shared";
import { env } from "../env.js";

const url = new URL(env.REDIS_URL);

/** Producer side of the worker's stats queue (used for the dashboard's "Recompute now"). */
export const statsQueue = new Queue(STATS_QUEUE, {
  connection: {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  },
});
