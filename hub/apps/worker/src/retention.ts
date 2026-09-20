import { sql } from "drizzle-orm";
import type { Database } from "@tcw/db";

export interface RetentionOptions {
  /** Raw events older than this are dropped (docs/PLAN.md section 8: 90 days). */
  eventRetentionDays: number;
  /** Hourly stats snapshots older than this are thinned to one per test per day. */
  fullSnapshotDays: number;
  now?: Date;
  /** Rows deleted per statement, so a big backlog never holds one long lock. */
  batchSize?: number;
}

export interface RetentionResult {
  events: number;
  snapshots: number;
  sessions: number;
  oauthCodes: number;
  oauthTokens: number;
}

const DAY_MS = 86_400_000;
const MAX_BATCHES = 500;

/** Pure: the instant before which a row is expired. */
export const cutoff = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/** How many rows a delete affected (node-postgres and PGlite report it differently). */
function affected(res: unknown): number {
  const r = res as { rowCount?: number | null; affectedRows?: number; rows?: unknown[] };
  return r.rowCount ?? r.affectedRows ?? r.rows?.length ?? 0;
}

/**
 * Housekeeping (docs/PLAN.md sections 8 and 11). Raw events are the bulk of the data and are only needed to
 * rebuild rollups; the aggregates that matter (pageviews, heat_bins, decisions, the library) are kept forever.
 * Events go in batches, so the delete never holds one huge lock; the events_ts_idx index makes each batch cheap.
 * This is a plain batched delete rather than monthly partitions: at the planned scale (under 500k visits a
 * month) it is simple and fast enough, and partitioning an existing table cannot be done additively.
 */
export async function purgeOldData(db: Database, opts: RetentionOptions): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const batch = opts.batchSize ?? 10_000;
  const eventCutoff = cutoff(now, opts.eventRetentionDays).toISOString();
  const snapshotCutoff = cutoff(now, opts.fullSnapshotDays).toISOString();
  const oauthCutoff = cutoff(now, 7).toISOString();
  const nowIso = now.toISOString();

  let events = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = affected(
      await db.execute(sql`delete from events where id in (select id from events where ts < ${eventCutoff}::timestamptz order by id limit ${batch})`),
    );
    events += n;
    if (n < batch) break;
  }

  // Keep the newest snapshot of each day for old rows: the confidence trend stays drawable, the table stops growing hourly.
  const snapshots = affected(
    await db.execute(sql`
      delete from stats_snapshots
      where computed_at < ${snapshotCutoff}::timestamptz
        and id not in (
          select distinct on (test_id, date_trunc('day', computed_at)) id
          from stats_snapshots
          where computed_at < ${snapshotCutoff}::timestamptz
          order by test_id, date_trunc('day', computed_at), computed_at desc
        )`),
  );

  const sessions = affected(await db.execute(sql`delete from sessions where expires_at < ${nowIso}::timestamptz`));
  const oauthCodes = affected(await db.execute(sql`delete from oauth_codes where expires_at < ${oauthCutoff}::timestamptz`));
  const oauthTokens = affected(
    await db.execute(sql`delete from oauth_tokens where expires_at < ${oauthCutoff}::timestamptz or revoked_at < ${oauthCutoff}::timestamptz`),
  );

  return { events, snapshots, sessions, oauthCodes, oauthTokens };
}
