# Handoff: state of the project and how to continue

Read this first, then `docs/PLAN.md` (the design), then `README.md` (setup, and "Which address goes where").
Repo: https://github.com/jamesdunnington/tcw-ab-tester (public, default branch **master**). Working folder: `D:\Vibe Coding\TCW AB Tester`.

## 1. Where things stand (2026-09-20)

The product is feature-complete: all five phases plus the Claude Desktop connector (`docs/MCP-PLAN.md`). It has been run for real against a local WordPress and works end to end. **It is deployed** (2026-09-20) on the owner's VPS at `https://test.thecontentwarrior.work`, with the connector at `https://mcptest.thecontentwarrior.work/mcp`, three WordPress sites connected (createondot.com, homedesigninsider.com, contentnetworkinsider.com, plugin 0.2.0). See section 8 for how the VPS is run. The remaining work is the off-server backup destination and a few small gaps (section 4).

**Git:** pushed to GitHub on 2026-09-20 (through `a4b3274`, after `npm run ci:local` and a production image build passed). The owner treats a push as a formal production copy: push only when asked, after `npm run ci:local` passes. Commits since the previous push (`1f71dd5`), newest first (the Plain-permalink warning and the `.table-wrap` fix are also in that range):

| Commit | What |
|---|---|
| `7165d23`, `8c58c22` | Domain handling: exact `/ingest` origin match, normalised site domain, optional visitor-facing hub address in the plugin, README fix |
| `5e28cfa` | Worker: retry unacknowledged ingest entries, dead-letter stream |
| `a05645a` | Plugin: logged-in editors/admins are kept out of tests |
| `c7b1e73`, `d55162a` | Handoff notes; test-detail page waits for the reload after Start/Stop/Recompute |
| `f8e63dc` | Ad-safe testing: redirect keeps `gclid`/`utm_*`/`#hash`; edits to ad containers refused |
| `c0049f4`, `19c1dfc` | "Restore original": hub service, API, Outcome panel (greyed "Original restored" once done), element-rule removal |
| `0d1a1a3`, `f44e705` | Plugin restore route; promote saves the original as a revision first |
| `ef94fe8`, `a3c0a58` | Logo + favicon; Swiss/minimalist dashboard restyle, dark toggle |
| `095ce7f`, `cf302a2`, `ddb6aef` | Fixes from the first WordPress shakedown |

Tests: about 260 across the workspaces, all green with `npm run ci:local`.

Production hostnames for later: hub `https://test.thecontentwarrior.work`, MCP `https://mcptest.thecontentwarrior.work` (hub on a VPS, WordPress sites on other servers).

## 2. What is proven (run for real, dev stack, owner's Chrome)

- Connect the plugin (signed heartbeat); create page and element tests; duplicate page; start (runtime config injected, split, redirect for page tests); tracking on both arms; ingest -> Redis -> worker -> Postgres -> stats (gates hold until 200 sessions per arm and 7 days).
- **Page test winner:** the original URL serves the challenger's content on the same post ID and slug; variant post and meta gone; archive row in WordPress and hub; library item recorded.
- **Element test, end to end:** visual editor on the real theme (text edit + goal), real-Chrome tracking incl. goal click, 20 fresh visitors split 10/10 with matching content and sticky arms, winner -> permanent rule (goal stripped, no tracking), **"Remove the permanent change"**.
- **Restore original** for both types (page: title/content/excerpt from the library snapshot, current version kept as a WordPress revision; element: removes the permanent rule).
- **Heatmap overlay** on the real theme: Clicks, Scroll stops, Attention layers, variant switch.
- Staff exclusion, worker crash recovery (also against the real Redis), origin check (against the real `/ingest`).

## 3. Not yet tested

- **Connector:** connected and working for read tools (list_sites, list_tests, audit entry `mcp.authorized`). The Draft tools, the Start/stop/decide scope and Claude Desktop's per-call approval prompts have NOT been exercised on the real server.
- **Consent:** verified once each way on a real AdSense (IAB TCF) banner from an EU/UK VPN (reject = 0 rows, accept = events). Partial choices ("Manage options") and a repeat reject are untested; Mediavine's banner was never seen.
- **Backup:** one dump was restored into a scratch database and all 16 tables matched (2026-09-20). NOT done: an off-server destination (`TCW_BACKUP_REMOTE` is unset, so dumps exist only on the VPS), and running the hub against a restored database.
- The overlay's Close button and the hover / rage-click / dead-click layers were not exercised (the simulator sends no such events); no automated browser test exists for hover, permanent rules or the heatmap overlay.
- The Login page was not checked visually after the restyle. Library was checked at 375px (no sideways scroll, no small targets). The Outcome panel was checked at 360px in light and dark: fits, 44px button; a page-level sideways scroll caused by an unclipped visually-hidden span in table cells was fixed with `position: relative` on `.table-wrap`.

## 4. Known gaps, in suggested order

1. **Plain permalinks:** the hub always calls `/wp-json/...`, so a site on Plain permalinks fails. Test Connection now warns (amber note) when `permalink_structure` is empty; the hub still does not fall back to `?rest_route=`. Only `php -l` checked; the warning path was not exercised against a Plain-permalink site.
2. **Split-horizon addresses:** the site `domain` in the hub is both where the hub calls WordPress and the Origin `/ingest` accepts, so a setup where they differ cannot work. Fine in production (one public name); in Docker use `host.docker.internal` everywhere (README explains). A future step is a per-site list of extra allowed origins.
3. **Dead-letter stream has no alert:** check with `XLEN tcw:ingest:events:dead` in Redis.
4. **Ads (AdSense + Mediavine Journey):** ask Mediavine support how a client-side redirect on a Journey page is treated; the hub measures engagement, not ad revenue (a challenger that changes page structure can change ad count and RPM).
5. A control visitor who opens the challenger's URL directly is not sent back; the old variant URL returns 404 after cleanup (no redirect).
6. MySQL's first start outlasts its 50s healthcheck (first `up` reports unhealthy: run `up -d` again, or add `start_period`).
7. Worker throughput is about 25 events/s (sequential processing); fine for the expected volume.
8. Older gaps: no TOTP; the hub does not re-push permanent rules to a reconnected plugin; SEO-plugin index tables are not purged directly on cleanup; the guardrail is click-rate only; raw events are pruned by a batched daily delete (deliberate); no PHP test suite (PHP is checked with `php -l` and scratch scripts on the running WordPress).
9. Optional: an MCP tool for "restore original" (`hub/apps/mcp/src/tools/`, live scope + confirm); the challenger label reads "B (variant)Sample Page B" on the old page test (label copied from WordPress); an ad-revenue metric.

## 5. Suggested order for the next session

1. Set the off-server backup destination (`TCW_BACKUP_REMOTE` + `TCW_RCLONE_*` in `~/n8n/.env`, owner enters the keys), run one manual backup, confirm the file is in the bucket.
2. Exercise the connector's Draft tools from Claude Desktop (draft an element test, see it as a draft in the dashboard, remove it with Delete draft); decide whether to ever grant the live scope.
3. Repeat the consent reject test, and test a "Manage options" partial choice.
4. Run a real test to the gates (200 sessions per arm and 7 days). Note the three tests so far were ended early by the owner (`test.decided`), so no winner has been produced from real traffic yet.
5. Known gaps in section 4 (plain-permalink fallback, dead-letter alert, ad revenue).

## 6. Behaviour worth knowing (decisions made, do not undo by accident)

- **Consent:** never decided at render time (page caches). `cfg.consent` is only a fallback; the browser reads WP Consent API / Complianz / CookieYes live. With no consent tool nothing is tracked, by design. For manual testing set `document.cookie='wp_consent_statistics=allow; path=/'`.
- **Staff exclusion:** logged-in users who can `edit_others_posts` get no test config (no split, no tracking, always the original page); decided winners (permanent rules) still apply. Setting "Include logged-in editors and admins in tests" (`tcwab_include_staff`) and filter `tcwab_exclude_visitor` turn it off. **While the owner is logged in to wp-admin the front end shows the original page: use a private window to see a live test.** `TCWAB_Runtime::is_excluded_visitor()` in `class-runtime.php`.
- **Restore original:** `restoreOriginal()` in `packages/core/src/services/decision.ts`; only for archived tests whose winner was not the control, once (`decisions.restored_at`, migration 0005; cleared again if WordPress fails). Page tests restore title, content and excerpt only (template, featured image and SEO fields are not in the snapshot). API `POST /api/tests/:id/restore-original`; `GET /api/tests/:id` also returns `outcome`. Audit action `test.original_restored`.
- **Ads:** page tests redirect (`redirectTarget` in `packages/tracker/src/runtime-inline.ts` keeps query and hash); element tests never redirect and keep the same URL and slug, so prefer them on monetised pages. `AD_SLOT_PATTERN` in `packages/shared/src/change-ops.ts` rejects selectors aimed at AdSense/Mediavine containers; the editor picker ignores anything inside an ad slot and swallows the click (its selector list is duplicated by hand because the editor bundle imports no values from shared).
- **Worker recovery:** `hub/apps/worker/src/stream-recovery.ts`. Every 30s (and at start) entries idle for 60s are claimed from any consumer and retried; a malformed entry is dropped; a store failure leaves the entry pending; after 5 deliveries it moves to `tcw:ingest:events:dead`.
- **Origin check:** `hub/apps/api/src/lib/origin.ts` compares host and port exactly, ignoring scheme and `www.`. `POST /api/sites` stores `scheme://host[:port]` (400 `invalid_domain` if unusable). The plugin's optional "Hub address for visitors" (`tcwab_hub_public_url`) is what gets printed into pages for browsers; WordPress's own calls use the Hub URL.
- **Delete draft:** `deleteDraftTest()` in `packages/core/src/services/decision.ts`, `POST /api/tests/:id/delete-draft` (drafts only, else 409 `only_drafts_can_be_deleted`), button + confirm dialog on the test page. A page draft's WordPress copy is removed first via the finalize call with `discard: true` (the plugin then writes no archive row; an older plugin ignores the flag and only adds a harmless archive row); the hub rows go only if WordPress succeeded. Audit action `test.draft_deleted`. Verified for real on the dev stack.
- **Consent (owner's decision 2026-09-20):** an IAB TCF banner (AdSense/Mediavine, `window.__tcfapi`) is honoured: gdprApplies false = track; otherwise purposes 1 and 8 must be granted; present-but-unanswered = NOT tracked. With no tool answering, the visitor IS tracked (`tcwab_default_consent` now defaults to true; return false from that filter for the old stricter behaviour). Cookie-based tools (Complianz, CookieYes) are still only honoured once the visitor has answered. **Not tested against a real banner** (no EU/UK connection available); unit tests use a fake CMP (`consent-tcf.test.ts`).
- **Also:** heat data flows tracker -> `heat.ts` `deriveHeatBins` -> `heat_bins`; token kinds `editor` and `heatmap`; `applyDecision` snapshots variants BEFORE finalize deletes anything and records the library item best-effort; winner email claims `tests.winner_notified_at` atomically; retention never deletes pageviews, heat_bins, decisions or library.

## 7. Dashboard design

Swiss/minimalist per the owner's choice: Schibsted Grotesk + Fira Code, ink on white with one vermilion accent, square corners, no shadows or boxed cards, heavy 2px section rules with `01/02/03` numbering, oversized tabular numerals. **Light is the default; Dark is an explicit header toggle** (`src/theme.ts`, `localStorage` key `tcw-theme`). Logo `hub/apps/dashboard/public/logo.svg`, favicon `favicon.svg`. Open question to the owner, unanswered: match the ink/accent to the logo's navy and orange.

Owner's standing rules for UI work: use the `frontend-design-pro` skill for the look and `ui-ux-pro-max` for buttons and UX logic; verify at desktop and 375px, light and dark; 44px targets, visible focus, WCAG AA, no hover-only actions. **Every link from the hub to WordPress opens in a new tab** (`target="_blank" rel="noreferrer"`; editor/heatmap links go through `src/open-tab.ts`).

## 8. Environment (this Windows PC)

- **Docker Desktop is on D:** (`D:\Docker\app`, data in `D:\Docker\wsl`). **C: is nearly full: nothing may store there.** `docker.exe` is not on PATH: in Git Bash `export PATH="$PATH:/d/Docker/app/resources/bin"`, in PowerShell `$env:Path += ";D:\Docker\app\resources\bin"`. Set `COMPOSE_PROGRESS=plain` for readable logs. No PHP on the host: lint and run PHP inside the container (`docker exec dev-wordpress-1 php -l <file>`; in Git Bash prefix `MSYS_NO_PATHCONV=1`).
- **Docker Desktop must be started by the owner**, not the agent (the Claude app is an MSIX package with a redirected `AppData`). A startup error "initializing Secrets Engine ... engine.sock" means a stale `AppData\Local\docker-secrets-engine`: rename that folder to a unique name.
- **The dev stack runs** (`docker compose -f dev/docker-compose.yml up -d --build`): dashboard http://localhost:5174, API :4000, WordPress **http://host.docker.internal:8080** (use this name, not `localhost`). A container rebuild can take longer than the 120s tool timeout: run it in the background and watch the log. Dev data: WordPress `siteurl`/`home` = `http://host.docker.internal:8080`, plugin `tcwab_hub_url` = `http://host.docker.internal:4000`, hub `sites.domain` = `http://host.docker.internal:8080`, site key `tcw_cf1af55550a44a90a45c4629c32ccd43`. Postgres on host port 5433 (`docker exec dev-postgres-1 psql -U tcwab -d tcwab`). Migrations `0000`-`0005` in `hub/apps/api/drizzle` (additive).
- **Dev data now:** three tests: an archived page test ("Sample Page", original restored), an archived element test (permanent change removed), and a stopped element test ("Bugfix check" headline, inconclusive). Scratch draft pages titled "SCRATCH ..." exist in WordPress and can be deleted.
- **Owner accounts:** a hub admin (`cshnyt@gmail.com`) and a WordPress admin. **The agent must never create accounts or type passwords**: the owner logs in themself, in their own Chrome (Claude in Chrome tools), then the agent can drive the pages.
- **Traffic simulator:** `dev/simulator/sim.mjs` posts synthetic visitors to the real `/ingest`: `SITE_KEY=... TEST_ID=... N=120 [ELEMENT=1] node dev/simulator/sim.mjs` (`ELEMENT=1` for element tests; rate limit 300 requests per 5 min per IP). To reach the winner gates fast: backdate `tests.started_at` 8 days in Postgres, send about 220+ visitors per arm (two runs, 5 minutes apart), then "Recompute now".
- **Production VPS (ssh alias `thecontentwarrior`, key auth, works from this PC):** the hub runs inside the owner's existing stack in `~/n8n` (`docker-compose.yml`, `.env`, `Caddyfile`), which also runs n8n, Postiz, Keila and Daybook behind one shared Caddy on `postiz-network`. Hub services are prefixed `tcw-` (`tcw-postgres`, `tcw-redis`, `tcw-api`, `tcw-worker`, `tcw-mcp`, `tcw-dashboard`, `tcw-backup`) and use `TCW_`-prefixed env vars (`TCW_POSTGRES_PASSWORD`, `TCW_SESSION_SECRET`, `TCW_SECRET_ENCRYPTION_KEY`; keep a copy of the last outside the VPS). Images come from `ghcr.io/jamesdunnington/tcw-ab-tester-{api,worker,mcp,dashboard,backup}:latest`. DNS is proxied by Cloudflare (a 525 there means Caddy had not loaded the new blocks). Caddyfile blocks must be multi-line (one-line `{ ... }` blocks are a syntax error); append with `cat >>`, not `sed -i`, because the container mounts the file. Deploy an update: push to master, wait for CI then the automatic "Publish images" run, then on the VPS `docker compose pull tcw-api tcw-worker tcw-mcp tcw-dashboard tcw-backup && docker compose up -d tcw-api tcw-worker tcw-mcp tcw-dashboard tcw-backup`. Over SSH only read and check; `docker compose exec` reads stdin, so run scripts from a file with `</dev/null`.
- **CI/CD:** `.github/workflows/ci.yml` runs on every push; `publish-images.yml` runs after CI succeeds on master (also manual, and on `v*` tags) and pushes the five images. A transient registry 502 can fail single jobs: `gh run rerun <id> --failed`.
- **Plugin zip:** none is committed; build it with Python `zipfile` from `wp-plugin/tcw-ab-tester` (forward slashes, folder at the top) into the ignored `dist/` folder, named `tcw-ab-tester-<version>.zip`. Version is set in two places in `tcw-ab-tester.php` and doubles as the cache-buster for `assets/tracker.js`.
- **Login page:** "First-time setup" is shown only while the hub has no user (`GET /api/auth/setup-open`); the server refuses account creation once a user exists (403). The hub is private: keep it that way.
- **Install everything inside the project** (npm workspaces); nothing global. Scratch scripts go in the session scratchpad (Git Bash `/tmp` is not the same place as the scratchpad).
- **Stale `dist`:** other workspaces import `@tcw/shared`, `@tcw/db`, `@tcw/stats`, `@tcw/core` from built `dist`; rebuild after changing one (`npm run build -w @tcw/<name>`). `npm run ci:local` builds everything and runs all tests. After changing `packages/tracker`, run `npm run tracker:build` (copies bundles to the API `public` and to the plugin `assets`, which is committed).
- **Tooling quirks:** the GateGuard hook refuses the first Write/Edit of each file per session and asks for importers, affected API, data shape and the verbatim instruction: state them, then retry the identical call (Bash edits bypass it). Recursive forced deletes and `git checkout --` need the same kind of statement. Foreground `sleep` is blocked: use a background command or a Monitor. Heredocs mangle long content: use Write/Edit for anything with escapes. Files check out with CRLF. **Encoding:** `README.md` and this file are UTF-8; when patching with Python always pass `encoding='utf-8'` (a default-encoding write once emptied the README; it was restored from git).
- **Browser:** in the owner's Chrome via the Claude in Chrome tools, the first click after a page load or form fill is sometimes swallowed (a driver quirk, not an app bug: click again), and screenshots sometimes time out after a native `<select>` opens (read the page text or the database instead). The built-in browser pane blocks page calls to `host.docker.internal:4000`.
- `gh` is signed in as `jamesdunnington`.

## 9. Owner's working rules (also in the agent's memory)

1. **CI runs locally in Docker for all projects** before anything is pushed; do not rely on GitHub Actions as the first place things run.
2. **A push to GitHub is a formal production copy**: only on request, only verified work. Commit locally as units finish.
3. Commit messages explain the why and end with the Co-Authored-By line from the session.
4. Test statistics against textbook reference values, not against the implementation.
5. Site secrets are encrypted, not hashed; the browser only knows the public site key.
6. Ops are a closed, validated set (text, html, style, attr, hide, goal); no custom JS op.

## 10. Where things are

| Area | Where |
|---|---|
| Hub API (Fastify, Drizzle) | `hub/apps/api` |
| Worker (Redis Streams ingest, BullMQ stats/retention, winner email, stream recovery) | `hub/apps/worker` |
| Dashboard (React/Vite) | `hub/apps/dashboard` |
| Claude connector (remote MCP + OAuth 2.1) | `hub/apps/mcp` |
| Shared logic: tests, decision, restore, analytics, heatmap, library, inspect | `packages/core` (apps hand it their db via `configureCore`; always use `getDb()`) |
| Types, HMAC, change-ops, ad-slot pattern, editor token | `packages/shared` |
| Drizzle schema | `packages/db` |
| Bayesian + frequentist stats, Engagement Score, `decideWinner` gate | `packages/stats` |
| Browser runtime (inline, under 2KB gzipped) + tracker + consent | `packages/tracker` |
| Visual editor overlay / heatmap overlay | `packages/editor`, `packages/heatmap` (heatmap must not import values from `@tcw/shared`) |
| WordPress plugin | `wp-plugin/tcw-ab-tester` (live-mounted into the dev WordPress, edits take effect at once) |
| Backups | `hub/backup` |
| Dev harness + simulator | `dev/` |
