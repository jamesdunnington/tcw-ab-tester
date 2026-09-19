import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: z.string().min(1),
  /** 64 hex chars: decrypts site secrets, so the connector can make the same signed calls to WordPress as the hub. */
  SECRET_ENCRYPTION_KEY: z.string().length(64),
  /** Signs the pending-authorization state on the login page. Same value as the api's is fine. */
  SESSION_SECRET: z.string().min(32),
  /** Public base URL of this connector, e.g. https://mcptest.thecontentwarrior.work. It is the OAuth issuer and the resource. */
  MCP_PUBLIC_URL: z.string().url(),
  /** Public URL of the hub dashboard, shown to the user in tool output so they can open the visual editor from it. */
  HUB_PUBLIC_URL: z.string().url(),
  /** Local development only: allow inspect_page to fetch a site on a private address. */
  ALLOW_PRIVATE_SITE_FETCH: z.enum(["0", "1"]).default("0"),
});

export const env = envSchema.parse(process.env);
