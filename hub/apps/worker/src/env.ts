import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** Public dashboard URL, for the link in emails. */
  HUB_PUBLIC_URL: z.string().default(""),
  /** e.g. smtps://user:pass@smtp.example.com:465. Unset = no email is sent. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("TCW A/B Tester <no-reply@localhost>"),
  /** Comma-separated recipients for the "winner found" email; empty = every hub user. */
  NOTIFY_EMAIL: z.string().default(""),
  /** Raw events older than this are deleted daily. Aggregates (pageviews, heat_bins, library) are kept. */
  EVENT_RETENTION_DAYS: z.coerce.number().int().min(7).default(90),
  /** Hourly stats snapshots older than this are thinned to one per day. */
  SNAPSHOT_FULL_DAYS: z.coerce.number().int().min(1).default(30),
});

export const env = envSchema.parse(process.env);
