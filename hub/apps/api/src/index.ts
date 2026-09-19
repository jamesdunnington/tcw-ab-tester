import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { siteRoutes } from "./routes/sites.js";
import { testRoutes } from "./routes/tests.js";
import { editorRoutes } from "./routes/editor.js";
import { resultRoutes } from "./routes/results.js";
import { wpRoutes } from "./routes/wp.js";
import { ingestRoutes } from "./routes/ingest.js";
import { decisionRoutes } from "./routes/decisions.js";

const app = Fastify({
  logger: {
    transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    level: env.NODE_ENV === "development" ? "info" : "warn",
  },
  trustProxy: true, // behind Caddy — needed for correct request.ip in ingest rate limiting
});

// Preserve the raw request body string so HMAC verification (lib/hmac-guard.ts)
// can recompute the signature over exactly the bytes WordPress signed.
app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  (request as unknown as { rawBody: string }).rawBody = body as string;
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    done(err as Error, undefined);
  }
});

await app.register(fastifyCookie, { secret: env.SESSION_SECRET });
await app.register(fastifyCors, {
  origin: env.ALLOWED_ORIGINS.length > 0 ? env.ALLOWED_ORIGINS : false,
  credentials: true,
});

// Serves packages/tracker's built output (runtime-inline.js, tracker.js).
// Long cache lifetime is safe: the WP plugin ships its own pinned copy of
// runtime-inline.js (it must be inline anyway), and tracker.js is
// versioned by plugin release, not fetched on a hot path for correctness.
const __dirname = dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: join(__dirname, "..", "public"),
  prefix: "/",
  cacheControl: true,
  maxAge: "1d",
  immutable: false,
});

app.get("/healthz", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(siteRoutes);
await app.register(testRoutes);
await app.register(editorRoutes);
await app.register(resultRoutes);
await app.register(decisionRoutes);
await app.register(wpRoutes);
await app.register(ingestRoutes);

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => app.log.info(`TCW hub API listening on ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
