import type { Pool } from "pg";
import { createDb, type Database } from "@tcw/db";
import { env } from "../env.js";

const instance: { db: Database; pool: Pool } = createDb(env.DATABASE_URL);

export const db: Database = instance.db;
export const pool: Pool = instance.pool;
