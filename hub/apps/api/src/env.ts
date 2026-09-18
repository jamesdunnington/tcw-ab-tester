import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  /** 64 hex chars (32 bytes) — AES-256-GCM key used to encrypt site secrets at rest. Generate with: openssl rand -hex 32 */
  SECRET_ENCRYPTION_KEY: z.string().length(64),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  /** Public base URL of the hub, e.g. https://ab.example.com — used to build WP callback/editor URLs. */
  HUB_PUBLIC_URL: z.string().min(1),
});

export const env = envSchema.parse(process.env);
