import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

/**
 * Each app (api, worker) owns its own env validation and calls this with
 * its own DATABASE_URL — keeps @tcw/db free of app-specific config concerns.
 */
export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>["db"];
