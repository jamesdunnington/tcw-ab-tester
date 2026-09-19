import type { Pool } from "pg";
import { createDb, type Database } from "@tcw/db";
import { configureCore } from "@tcw/core";
import { env } from "../env.js";

const instance: { db: Database; pool: Pool } = createDb(env.DATABASE_URL);

export const db: Database = instance.db;
configureCore({ db, secretKeyHex: env.SECRET_ENCRYPTION_KEY });
export const pool: Pool = instance.pool;
