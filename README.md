# TCW A/B Tester

Engagement-based A/B testing for WordPress: pages, posts, and individual
elements. All data, statistics, and the visual editor
live on a self-hosted **hub** (Docker, Node.js, React, PostgreSQL) on your
own VPS; the WordPress plugin is a thin, HMAC-signed bridge to it.

Full design: [docs/PLAN.md](docs/PLAN.md).

## Status: all five phases built, plus the Claude Desktop connector

Working end to end: connect a site to the hub, create a page/post split
test, the plugin duplicates the post on WordPress, the hub pushes the live
config, visitors are split and tracked (active time, scroll, hover, click —
never page views). Every hour the worker scores each session (Engagement
Score) and runs Bayesian analysis with frequentist confirmation
(`packages/stats`). A winner is declared only when every gate passes: no
sample-ratio mismatch, minimum sample, minimum run time, P(best) at the
threshold, expected loss under 1%, and a click-rate guardrail. The dashboard
shows why, then asks what to keep and whether to delete the redundant copy;
WordPress promotes the winner into the original first and only then deletes
or hides the copies. Test data is kept in the hub archive either way.

Element tests (phase 3): a point-and-click visual editor opens on the live
page, edits are saved as typed change operations, and the runtime applies them
in the browser without flicker. The winning edits become a permanent rule
served to everyone with no tracking. You can create and edit them from the
dashboard, or by chatting with Claude (below).

**Claude Desktop connector:** a remote MCP server with OAuth lets Claude set up
tests (as drafts), read results and detailed analytics, explain the findings,
and, only if you grant it and confirm in chat, start tests or apply winners.
See "Connect Claude Desktop" below.

**Heatmaps (phase 4):** the tracker records where clicks land inside each element
(a selector plus a percent offset, so maps survive responsive layouts), which links
and buttons get hovered, which sections were actually seen for a second, where
scrolling pauses, and dead and rage clicks. The worker keeps them forever as
aggregates. The test page shows the top elements per layer and the scroll drop-off,
and "View on the live page" paints them over the real page (a read-only overlay,
same signed-link and WordPress-login gate as the editor). Claude reads them with
`get_heatmap`. "Key sections seen" is the fifth Engagement Score component.

**Library, notifications, consent, retention, backups (phase 5):** every decided test
is kept in a cross-site library (with the page content snapshotted before any copy is
deleted). Reuse one on another site as a draft test, a draft post, or (winners only,
confirmed) a permanent change, from the dashboard or through Claude. An email goes out
once when a winner is found (`SMTP_URL`). Statistics consent is read live in the
visitor's browser from the WP Consent API, Complianz or CookieYes, with an optional
strict mode. Raw events are deleted after 90 days (aggregates stay). A backup service
copies a nightly `pg_dump` off the server (`BACKUP_REMOTE`, any S3-compatible storage).

**Known gaps** (see [docs/PLAN.md](docs/PLAN.md) §11): SEO-plugin index tables are not
purged directly on cleanup; a permanent rule cannot be removed from the UI yet; raw
events are pruned by a batched daily delete rather than monthly partitions (fine at
the planned scale); **the WordPress plugin has never been run inside a real
WordPress** (only syntax-checked in CI), so expect a shakedown pass on the first
install.

Run the same checks CI runs (Node parts) with `npm run ci:local`.

## Repository layout

```
hub/apps/api/         Fastify + TypeScript admin API, WP bridge, /ingest
hub/apps/worker/       Redis Streams consumer -> Postgres (events, rollups)
hub/apps/mcp/          Claude Desktop connector: remote MCP (Streamable HTTP) + OAuth server
hub/apps/dashboard/    React + Vite dashboard (all test management + results)
hub/docker-compose.yml Production stack (Caddy + api + worker + mcp + dashboard + postgres + redis + backup)
hub/backup/             Nightly pg_dump -> off-box storage (rclone)
packages/shared/       Types, zod schemas, the HMAC signing algorithm
packages/db/           Drizzle ORM schema + client (shared by api, worker & mcp)
packages/core/          Business logic shared by the api and the connector: tests, winner flow, analytics, page inspector, WP client
packages/editor/        The visual editor overlay (vanilla TS, Shadow DOM)
packages/heatmap/       The heatmap overlay painted over the live page (vanilla TS, Shadow DOM)
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
2. Open http://host.docker.internal:8080 (not `localhost`: see "Which address goes where" below) → finish the
   WordPress install → activate **TCW A/B Tester** under Plugins. On Windows and macOS Docker Desktop makes
   `host.docker.internal` resolve on your own machine too; on Linux add `127.0.0.1 host.docker.internal` to
   your hosts file.
3. **Sites** → add a site with the domain `http://host.docker.internal:8080` → copy the Site Key + Site Secret
   shown once.
4. In wp-admin → Settings → TCW A/B Tester: Hub URL `http://host.docker.internal:4000`, paste the Site
   Key/Secret, **Save Settings**, then **Test Connection**. Leave "Hub address for visitors" blank.
5. Back in the dashboard: **Sites → View tests → Create test**, entering the
   WordPress post/page ID to test. **Create challenger**, then **Start test**.
6. Visit the post on http://host.docker.internal:8080 a few times (private/incognito
   windows to get different `tcwab_vid` assignments; you must be logged out of wp-admin, because logged-in
   editors and admins are kept out of tests) to generate data, then check **Results** on the test's page in
   the dashboard.

### Which address goes where

Two addresses are each used twice, once by a server and once by a visitor's browser. They only cause trouble
when the server and the browser reach the same thing by different names, which is what Docker does by default.

| Where you enter it | What the server uses it for | What the browser uses it for |
|---|---|---|
| **Site domain** in the hub (Sites → add a site) | The hub calls WordPress there (`/wp-json/...`) | The tracker's requests must come from this host: `/ingest` rejects other origins. `www.` and `http` vs `https` do not matter; a trailing slash or path is stripped. |
| **Hub URL** in the plugin | WordPress calls the hub there (heartbeat, config) | Printed into your pages as the tracking address, and used to load the visual editor and heatmap |
| **Hub address for visitors** in the plugin (optional) | not used | Replaces the Hub URL in what is printed into pages. Leave blank unless visitors reach the hub by a different address than your server does. |

In production these all coincide: the site domain is the site's public address and the Hub URL is
`https://<HUB_DOMAIN>`, so there is nothing to think about. In Docker, `localhost` means a different machine
inside each container, so use one name that works from everywhere: `host.docker.internal`, as in the steps above.
If a test never records visitors, check the site domain first: it must match the address in the visitor's browser.

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

`MCP_DOMAIN` (for example `mcptest.yourdomain.com`) is the host the Claude
connector is served on. It needs its own DNS record pointing at the VPS, the same
as `HUB_DOMAIN`; Caddy provisions its certificate too.

### Connect Claude Desktop

Claude reaches connectors from Anthropic's side, so the hub must be on public
HTTPS (the VPS above); `localhost` will not work. Then, in Claude Desktop:
**Settings > Connectors > Add custom connector**, name it, and use the URL
`https://<MCP_DOMAIN>/mcp`. Claude opens a sign-in page on your hub: log in with
your hub admin email and password, then choose what to allow:

- **Read** (always): sites, tests, statistics, analytics, page structure.
- **Draft**: create tests and edit variants. Nothing goes live.
- **Start, stop and decide** (off by default): start a test, stop it, apply a winner.
  Even with this on, Claude is told to ask you first and each call needs
  `confirm: true`; Claude Desktop also shows an approval prompt per call.

Then chat, for example: "Find my Pricing page and draft a test that changes the
button to say Start free trial", or "How is the pricing test doing, and why?".
Every action Claude takes is written to the hub audit log under the connector's
name. Tokens last an hour and refresh automatically; revoke access by removing
the connector in Claude. Sign-in attempts are rate limited and failures are logged.

### Email, retention and backups

All optional and set in `hub/.env` (see the comments in `.env.example`):

- `SMTP_URL` (with `MAIL_FROM`, `NOTIFY_EMAIL`): the "winner found" email. Unset = no email.
- `EVENT_RETENTION_DAYS` (90) and `SNAPSHOT_FULL_DAYS` (30): a daily worker job deletes raw
  events past the limit and thins old hourly stats snapshots to one per day.
- `BACKUP_REMOTE` plus the `RCLONE_CONFIG_OFFSITE_*` variables: where the nightly dump goes.
  Take one now with `docker compose -f hub/docker-compose.yml run --rm backup /usr/local/bin/backup.sh`.
  Restore into an empty database with
  `pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL" tcwab-<stamp>.dump`.
  Test a restore once before you rely on it. Redis (the ingest buffer) is deliberately not backed up.

## Why some things are built the way they are

A few decisions that aren't obvious from the code alone — see the comments
at each site for the full reasoning:

- **Consent is decided in the browser, never when WordPress renders the page**
  (`packages/tracker/src/consent.ts`). The rendered HTML is what a page cache stores, so a
  server-side answer would freeze the first visitor's choice for everyone. The server only
  supplies the fallback used when no consent tool has answered.
- **Heatmap and editor links use different token kinds** (`packages/shared/src/editor-token.ts`):
  a heatmap token is read-only and cannot save edits, and an editor token cannot read heat data.
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
