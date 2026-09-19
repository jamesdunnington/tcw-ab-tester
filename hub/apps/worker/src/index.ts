import { runConsumer } from "./consumer.js";
import { startStatsScheduler } from "./scheduler.js";

// Two concerns in one process: the continuous ingest-stream consumer and the
// scheduled stats jobs. Split them into separate processes if either ever needs to scale alone.
startStatsScheduler().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] stats scheduler failed to start:", err);
  process.exit(1);
});

runConsumer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal error, exiting:", err);
  process.exit(1);
});
