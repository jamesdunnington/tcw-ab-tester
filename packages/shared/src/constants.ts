/** Redis keys/names shared between the API (producer) and worker (consumer). */
export const INGEST_STREAM_KEY = "tcw:ingest:events";
export const INGEST_CONSUMER_GROUP = "tcw-workers";

/** BullMQ queue the worker consumes and the API enqueues manual recomputes onto. */
export const STATS_QUEUE = "tcw-stats";
export const RECOMPUTE_TEST_JOB = "recompute-test";

/** Heatmap layers (docs/PLAN.md sections 4 and 7). rage/dead are click subsets worth seeing on their own. */
export const HEAT_LAYERS = ["click", "hover", "scroll", "attention", "rage", "dead"] as const;
export type HeatLayer = (typeof HEAT_LAYERS)[number];
/** Clicks are binned on a GRID x GRID grid inside their element (cell = offset percent / (100 / GRID)). */
export const HEAT_GRID = 10;
/** Scroll stops are binned in 5% steps of page height. */
export const SCROLL_BINS = 20;
