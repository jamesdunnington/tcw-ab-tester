# @tcw/worker

Consumes the raw tracker-event stream the API's `/ingest` route writes to
(Redis Streams, `tcw:ingest:events`) and folds each event into:

- `events` — the raw, permanent record
- `assignments` — first-seen (test, visitor) -> variant mapping
- `pageviews` — the per-(session, test) rollup the phase-1 results view reads

## Why Redis Streams here instead of BullMQ

`docs/PLAN.md` names BullMQ for the worker's job types (aggregation, stats
recompute, cleanup). Those are genuinely job-shaped: discrete, scheduled,
retryable units of work, and BullMQ is the right fit for them once phase 2
lands (hourly stats recompute) and phase 2's winner-flow cleanup jobs exist.

Continuous high-volume event ingestion is a different shape: an ordered,
at-least-once, unbounded stream, which is exactly what Redis Streams +
consumer groups were built for, with none of BullMQ's per-job bookkeeping
overhead. `/ingest` XADDs onto the stream; this process reads it via
`XREADGROUP`, and `XAUTOCLAIM` reclaims anything left idle by a crashed
worker. BullMQ gets added alongside this in phase 2 for the scheduled jobs,
not as a replacement for the stream consumer.
