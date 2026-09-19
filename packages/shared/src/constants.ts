/** Redis keys/names shared between the API (producer) and worker (consumer). */
export const INGEST_STREAM_KEY = "tcw:ingest:events";
export const INGEST_CONSUMER_GROUP = "tcw-workers";

/** BullMQ queue the worker consumes and the API enqueues manual recomputes onto. */
export const STATS_QUEUE = "tcw-stats";
export const RECOMPUTE_TEST_JOB = "recompute-test";
