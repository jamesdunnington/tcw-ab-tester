# TCW A/B Tester

Engagement-based A/B testing for WordPress: pages, posts, and (in a later
phase) individual elements. All data, statistics, and the visual editor
live on a self-hosted **hub** (Docker, Node.js, React, PostgreSQL) on your
own VPS; the WordPress plugin is a thin, HMAC-signed bridge to it.

Full design: [docs/PLAN.md](docs/PLAN.md).

## Status: Phase 1 (Foundation)

Working end to end: connect a site to the hub, create a page/post split
test, the plugin duplicates the post on WordPress, the hub pushes the live
config, visitors are split and tracked (active time, scroll, hover, click —
never page views), and the dashboard shows basic per-variant results.

**Not yet built** (see [docs/PLAN.md](docs/PLAN.md) §11 for the phase plan):
statistical significance / winner detection (phase 2), the winner
promote+cleanup flow (phase 2), the visual point-and-click editor and
element-level tests (phase 3), heatmaps (phase 4), cross-site reuse
library (phase 5).

## Repository layout

```
hub/apps/api/         Fastify + TypeScript admin API, WP bridge, /ingest
hub/apps/worker/       Redis Streams consumer -> Postgres (events, rollups)
hub/apps/dashboard/    React + Vite dashboard (all test management + results)
hub/docker-compose.yml Production stack (Caddy + api + worker + dashboard + postgres + redis)
packages/shared/       Types, zod schemas, the HMAC signing algorithm
packages/db/           Drizzle ORM schema + client (shared by api & worker)
packages/tracker/       Browser runtime: the inline assignment script + the full engagement tracker
wp-plugin/tcw-ab-tester/  The WordPress plugin
dev/docker-compose.yml Local end-to-end harness: hub (plain HTTP) + WordPress + MySQL
```

## Local development

Prerequisites: Node.js 20+, Docker (for the dev harness / production deploy).

```bash
npm install
npm run tracker:build   # builds packages/tracker, copies into hub/apps/api/public/ and wp-plugin/.../assets/
npm run build           # type-checks + builds every workspace package
npm test                # unit tests (packages/shared's HMAC algorithm)
```

### Full end-to-end test (hub + real WordPress)

```bash
docker compose -f dev/docker-compose.yml up --build
```

Then:
1. Open http://localhost:5174 → **First-time setup** → create an admin account.
2. **Sites** → add a site (any domain label is fine for local testing) →
   copy the Site Key + Site Secret shown once.
3. Open http://localhost:8080 → finish the WordPress install → activate
   **TCW A/B Tester** under Plugins.
4. In wp-admin → Settings → TCW A/B Tester: Hub URL `http://api:4000`
   (container-to-container — not `localhost`), paste the Site Key/Secret,
   **Save Settings**, then **Test Connection**.
5. Back in the dashboard: **Sites → View tests → Create test**, entering the
   WordPress post/page ID to test. **Create variant B**, then **Start test**.
6. Visit the post on http://localhost:8080 a few times (private/incognito
   windows to get different `tcwab_vid` assignments) to generate data, then
   check **Results** on the test's page in the dashboard.

### Production deploy

```bash
cp hub/.env.example hub/.env   # fill in HUB_DOMAIN, POSTGRES_PASSWORD,
                                # SESSION_SECRET, SECRET_ENCRYPTION_KEY (see
                                # the comments in .env.example for how to
                                # generate each one)
docker compose -f hub/docker-compose.yml --env-file hub/.env up -d --build
```

`HUB_DOMAIN` must be a real DNS name pointing at the VPS with ports 80/443
open — Caddy provisions its TLS certificate automatically. Then install
`wp-plugin/tcw-ab-tester` on each WordPress site (zip the folder, or copy it
into `wp-content/plugins/`) and connect it the same way as the dev walkthrough
above, using `https://<HUB_DOMAIN>` as the Hub URL.

## Why some things are built the way they are

A few decisions that aren't obvious from the code alone — see the comments
at each site for the full reasoning:

- **Site secrets are encrypted, not hashed** (`hub/apps/api/src/lib/crypto.ts`).
  Verifying an inbound HMAC signature requires recomputing it with the raw
  secret, which a one-way password hash can never provide.
- **The worker consumes Redis Streams, not BullMQ**, for raw event ingest
  (`hub/apps/worker/README.md`) — BullMQ is still the plan for phase 2's
  scheduled jobs (stats recompute, cleanup); streams fit continuous
  high-volume ingest better.
- **The browser never knows the hub's internal site UUID**, only the public
  site key (`packages/tracker/src/runtime-inline.ts`) — the API resolves
  the real site server-side from that key on every `/ingest` call and
  stamps the UUID on afterward, so a compromised/forged client value can
  never matter.
- **Variant posts are `publish`, not `draft`**
  (`wp-plugin/tcw-ab-tester/includes/class-variants.php`) — an anonymous
  visitor has to load them directly with no WordPress auth. They're kept
  out of search/sitemaps/feeds via `class-seo-guard.php` instead.
