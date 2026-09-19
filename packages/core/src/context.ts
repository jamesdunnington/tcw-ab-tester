import type { Database } from "@tcw/db";

/**
 * The api and the mcp app each own their env validation and database pool, and hand both to
 * core once at startup (their db module calls configureCore). Keeps core free of app config.
 */
let database: Database | null = null;
let secretKey: Buffer | null = null;

export function configureCore(opts: { db: Database; secretKeyHex: string }): void {
  database = opts.db;
  secretKey = Buffer.from(opts.secretKeyHex, "hex");
}

export function getDb(): Database {
  if (!database) throw new Error("core_not_configured: call configureCore() first");
  return database;
}

export function getSecretKey(): Buffer {
  if (!secretKey) throw new Error("core_not_configured: call configureCore() first");
  return secretKey;
}
