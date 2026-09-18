import { runConsumer } from "./consumer.js";

runConsumer().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal error, exiting:", err);
  process.exit(1);
});
