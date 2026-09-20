# Handoff: state of the project and how to work in it

Read this, then `docs/PLAN.md` (the design), then `README.md` (setup and the non-obvious design decisions).
Repo: https://github.com/jamesdunnington/tcw-ab-tester (public, default branch **master**). Working folder: `D:\Vibe Coding\TCW AB Tester`.

## Where things stand (2026-09-20)

All five phases and the Claude Desktop connector (`docs/MCP-PLAN.md`) were built earlier and are on GitHub (last pushed commit `1f71dd5`). **Everything since is committed locally and NOT pushed** (the owner says a push to GitHub is a formal production copy: push only when asked, after local Docker CI passes). Nothing is deployed. Production hostnames for later: hub `https://test.thecontentwarrior.work`, MCP `https://mcptest.thecontentwarrior.work` (hub on a VPS, WordPress sites on other servers).

Local commits, oldest first: `ddb6aef` Docker fixes (.dockerignore, 64-char dev key) · `cf302a2` variant 404 + menu leak + Control/Challenger labels · `095ce7f` challenger tracking + Redis stream trim · `a3c0a58` Swiss dashboard restyle, dark toggle, new-tab links · `ef94fe8` logo + favicon · `f44e705` promote keeps the original as a revision · `0d1a1a3` plugin restore route � **then "Restore original" hub + dashboard (see below)**.

The first real-WordPress shakedown was done on a **page test** end to end. It found and fixed real bugs (list below). 240 unit tests passed locally after the label rename (`npm run ci:local`).

## The shakedown, what is proven

Proven in the running dev stack: connect plugin (signed heartbeat), create page test, duplicate page, start test (runtime config injected, split, redirect to challenger), tracking on both original and challenger, ingest -> Redis -> worker -> Postgres -> stats (challenger +78% found, gates held until 200 sessions and 7 days), heatmap click layer, winner flow (apply challenger + delete copy: original URL serves the challenger's content on the same post ID and slug, variant post and meta gone, archive row in WP and hub, library item recorded, runtime config emptied).

**Also proven with the owner logged in (Chrome via the Claude in Chrome tools): element test + visual editor + goal, real-browser tracking incl. goal click, 10/10 visitor split with sticky arms, winner -> permanent rule, "Remove the permanent change", and the heatmap overlay on the real theme (Clicks, Scroll stops and Attention layers render, variant switch works; clicks whose element is not on the page are counted as "not found").**

**Not yet tested (needs the owner logged in to wp-admin at `http://host.docker.internal:8080/wp-admin`, the agent must not type passwords):** Claude Desktop connector (tracking from a real browser needs `document.cookie='wp_consent_statistics=allow; path=/'` first because there is no consent tool; the built-in browser pane blocks calls to port 4000, use the owner's Chrome), VPS deploy, backup + restore.

## Done: "Restore original" (the owner asked for this)

After a winner replaces the original, the test's **Outcome** section (archived tests) lets the owner get it back.
- Page tests: `restoreOriginal(testId, actor)` in `packages/core/src/services/decision.ts` sends `library_items.snapshots.a` (title, content, excerpt) to the plugin route `POST /tcwab/v1/posts/{id}/restore`; WordPress saves the current version as a revision first. Template, featured image and SEO fields are NOT in the snapshot and are not restored.
- Element tests: the same call removes the permanent rule (`DELETE /tcwab/v1/rules/{testId}`).
- Guards: archived only, chosen variant not the control, snapshot present (page tests), once (atomic claim on `decisions.restored_at`, migration 0005; cleared again if WordPress fails). Audit action `test.original_restored`.
- API: `POST /api/tests/:id/restore-original`; `GET /api/tests/:id` now also returns `outcome` (`chosenKey`, `chosenLabel`, `decidedAt`, `restorable`, `restoredAt`). Dashboard: `components/OutcomePanel.tsx` with a confirm dialog.
- Tested: 3 new cases in `hub/apps/mcp/src/__tests__/e2e.test.ts`; run for real against the dev WordPress (the archived "Sample Page" test was restored by a scratch script: original text back, challenger version kept as a revision). `npm run ci:local` green. NOT yet clicked through in the dashboard by a logged-in owner, and not checked visually at 375px / dark. Not done: an MCP tool for it (optional, would go in `hub/apps/mcp/src/tools/`, live scope + confirm).

## Ads (AdSense + Mediavine Journey run on the owner's pages)

- Page tests redirect challenger visitors to the copy's URL; the redirect now keeps `?gclid`, `utm_*` and `#hash` (`redirectTarget` in `packages/tracker/src/runtime-inline.ts`, tested).
- Element tests never redirect (same URL, same slug): prefer them on monetised pages. The owner's stance: no redirect + same slug means ads are fine. Still true that ad networks place ads by page structure, so restructuring a challenger can change ad count and RPM; the hub measures engagement, not ad revenue.
- Ad containers cannot be edited: `AD_SLOT_PATTERN` in `packages/shared/src/change-ops.ts` rejects such selectors, and the editor picker ignores anything inside an ad slot (and swallows the click so the owner cannot click their own ad). The picker's selector list is duplicated by hand because the editor bundle imports no values from shared.
- Not done: ask Mediavine support how a client-side redirect on a Journey page is treated; add an ad-revenue metric.

## Bugs found by running it for real (all fixed and committed)

Missing root `.dockerignore` (host Windows node_modules broke the Linux image) · dev `SECRET_ENCRYPTION_KEY` 60 chars, needs 64 · the plugin's `pre_get_posts` filter made every variant page a 404 (now skips singular requests) · variants leaked into the Pages menu block and sitemaps (added `get_pages` and sitemap filters) · the tracker/config were only printed on the original post so challenger traffic was never recorded (`tests_for_post` now matches variants of the tested post) · the worker XACKed but never deleted ingest entries, so the Redis stream grew forever (now XDEL) · promote overwrote the original with no way back (WordPress does NOT keep the previous content; now saved as a revision first) · promote passed unslashed content to `wp_update_post`, corrupting backslashes (now `wp_slash`).

## Bugs and gaps found, NOT fixed

- Admin/editor exclusion from tests is in the plan (section 3) but not implemented anywhere.
- Worker crash recovery: `reclaimStale` in `hub/apps/worker/src/consumer.ts` XAUTOCLAIMs entries but never processes or acks them.
- The hub always calls `/wp-json/...`; a site on Plain permalinks fails. Plugin Test Connection should detect and warn.
- One field does two jobs twice: the site `domain` is both where the hub calls WordPress AND the Origin `/ingest` accepts; the plugin's hub URL is both its server-to-server address and the browser's ingest URL (`class-runtime.php` uses `get_hub_url()`; `HUB_PUBLIC_URL` exists in the API env but is unused for this). Fine in production (same public URL), needs a single hostname in Docker (see below). README's "any domain label is fine for local testing" is wrong and must be corrected.
- A control visitor who opens the challenger's URL directly is not sent back to the original; the old variant URL returns 404 after cleanup (no redirect).
- MySQL's first start outlasts its 50s healthcheck, so the first `up` reports it unhealthy: wait for healthy and run `up -d` again, or add `start_period`/raise `retries`.
- Worker throughput is about 25 events/s (sequential `handleEntry`); fine for the expected volume, note if bursts matter.
- Older known gaps still stand: no TOTP; the hub does not re-push permanent rules to a reconnected plugin; SEO-plugin index tables are not purged directly on cleanup; guardrail is click-rate only; raw events are pruned by a batched daily delete, not partitions (deliberate); hover/permanent-rule/heatmap overlay have no automated browser test.

## Dashboard design (done this session)

Swiss/minimalist per the owner's choice: Schibsted Grotesk (`@fontsource-variable/schibsted-grotesk`) + Fira Code for code, ink on white with one vermilion accent, square corners, no shadows or boxed cards, heavy 2px section rules with `01/02/03` numbering, oversized tabular numerals. **Light is the default; Dark mode is an explicit header toggle** (`src/theme.ts`, `localStorage` key `tcw-theme`, guarded). Logo: `hub/apps/dashboard/public/logo.svg` (transparent, made from the owner's `D:\Affiliate Marketing\13. James Dunnington\Logo\TCW\content-warrior.svg` minus its background rect) in the header, `favicon.svg` (helmet on a light tile) as the icon; the logo is inverted with a CSS filter in dark mode. Possible follow-up the owner has not answered: match the ink/accent to the logo's navy and orange.

Owner's standing rules for UI work: use the `frontend-design-pro` skill for the look and the `ui-ux-pro-max` skill for buttons and UX logic; verify at desktop and 375px, light and dark; 44px targets, visible focus, WCAG AA, no hover-only actions. **Every link from the hub to WordPress opens in a new tab** (`target="_blank" rel="noreferrer"`; editor/heatmap links go through `src/open-tab.ts`, which opens the tab inside the click and navigates it after the request, so pop-up blockers allow it and the hub tab is never taken over). Only the Sites, Tests and test-detail pages were checked visually after the restyle; Login and Library were not.

## Environment (this Windows PC)

- **Docker Desktop is installed on D:** (`D:\Docker\app`, data in `D:\Docker\wsl`). **C: is nearly full (~22GB free): nothing may store there.** `docker.exe` is not on PATH: `$env:Path += ";D:\Docker\app\resources\bin"`; set `COMPOSE_PROGRESS=plain` for readable logs (`--progress` is not a valid flag). No PHP on the host: lint/run PHP inside the container, `docker exec dev-wordpress-1 php -l <file>`; in Git Bash prefix `MSYS_NO_PATHCONV=1` or `/tmp/...` paths get mangled.
- **Docker Desktop must be started by the owner**, not the agent (the Claude app is an MSIX package with a redirected `AppData`; its own launches see a different environment). A recurring startup error "initializing Secrets Engine ... engine.sock ... cannot be accessed" is a stale `AppData\Local\docker-secrets-engine`; rename that folder to a unique name (earlier `-old-*` renames are still there).
- **The dev stack currently runs** (`docker compose -f dev/docker-compose.yml up -d --build`): dashboard http://localhost:5174, API :4000, WordPress **http://host.docker.internal:8080**. Dev-only data changes made to get a single hostname working: WordPress `siteurl`/`home` = `http://host.docker.internal:8080` (permalinks set to Post name), plugin option `tcwab_hub_url` = `http://host.docker.internal:4000`, hub `sites.domain` = `http://host.docker.internal:8080`. Postgres is reachable on host port 5433 (`docker exec dev-postgres-1 psql -U tcwab -d tcwab`). The owner has a hub admin (`cshnyt@gmail.com`) and a WordPress admin; **the agent must not create accounts or type passwords**. Element-test walkthrough so far (this session): created, edited in the visual editor on the real theme (1 text edit + goal), started, real-Chrome tracking incl. goal click reached the hub, 20 fresh visitors split 10/10 with matching headlines, returning visitor sticky; simulated ~440 visitors and backdated the start 8 days to reach the winner gates. Still to do: winner -> permanent rule -> "Remove the permanent change". Fixed: after Start test/Stop/Recompute the page showed the old badge and an enabled Start button until reload (act() in TestDetail.tsx now waits for the reload before clearing busy and showing the banner). Note: in the automated Chrome the first click after a page load or form fill is sometimes swallowed; that is a driver quirk, not an app bug. The finished test in the dev DB is an archived "Sample Page" page test. Scratch draft pages titled "SCRATCH ..." exist in that WordPress and can be deleted.
- **Traffic simulator:** `dev/simulator/sim.mjs` posts synthetic visitors (consent true, correct Origin) to the real `/ingest`; run with `SITE_KEY=... TEST_ID=... N=120 node dev/simulator/sim.mjs` (rate limit 300 requests per 5 min per IP). The challenger has a built-in advantage. To reach the winner gates fast: backdate `tests.started_at` 8 days in Postgres and send about 200+ visitors per arm, then "Recompute now" in the dashboard.
- **Install everything inside the project** (npm workspaces); nothing global. Scratch scripts go in the session scratchpad.
- **Stale `dist`:** other workspaces import `@tcw/shared`, `@tcw/db`, `@tcw/stats`, `@tcw/core` from built `dist`; rebuild after changing one (`npm run build -w @tcw/<name>`). `npm run ci:local` builds everything and runs all tests (mirrors the Node CI job).
- **Shell:** heredocs break past ~150 lines and mangle backslashes: use Write/Edit for anything with escapes. **GateGuard hook:** the first Write/Edit of each file per session is refused once and asks for importers, affected API, data shape and the verbatim instruction: state them briefly, then retry the identical call. Bash edits bypass it. Recursive forced deletes are blocked by a hook. Files check out with CRLF; normalise before multi-line patching.
- **Browser checks:** the built-in browser pane works for the dashboard (resize with `resize_window`, reset to `desktop` afterwards). Native `<select>` cannot be driven; set the value via JS and dispatch `change`. The pane blocks page calls to `host.docker.internal:4000`.
- `gh` is signed in as `jamesdunnington`.

## Owner's working rules (also in the agent's memory)

1. **CI runs locally in Docker for all projects** before anything is pushed; do not rely on GitHub Actions to be the first place things run.
2. **A push to GitHub is a formal production copy**: push only when asked, only verified work. Commit locally as units finish.
3. Commit messages explain the why and end with the Co-Authored-By line from the session.
4. Test statistics against textbook reference values, not against the implementation.
5. Site secrets are encrypted, not hashed; the browser only knows the public site key.
6. Ops are a closed, validated set (text, html, style, attr, hide, goal); no custom JS op.
7. Deployment order when the time comes: DNS for `test.` and `mcptest.`, `hub/.env` (see `.env.example`: `MCP_DOMAIN`, optional `SMTP_URL`, `BACKUP_REMOTE` + `RCLONE_CONFIG_OFFSITE_*`), then verify the connector in Claude Desktop (Settings > Connectors > Add custom connector > `https://mcptest.thecontentwarrior.work/mcp`; check `ALLOWED_REDIRECT_HOSTS` in `oauth/provider.ts`, token refresh, tool approval prompts), and take one backup by hand and test a restore before trusting it.

## What exists (unchanged architecture)

| Area | Where |
|---|---|
| Hub API (Fastify, Drizzle) | `hub/apps/api` |
| Worker (Redis Streams ingest, BullMQ stats/retention, winner email) | `hub/apps/worker` |
| Dashboard (React/Vite) | `hub/apps/dashboard` |
| Claude connector (remote MCP + OAuth 2.1) | `hub/apps/mcp` |
| Shared logic: tests, decision, analytics, heatmap, library, inspect | `packages/core` (apps hand it their db via `configureCore`; always use `getDb()`) |
| Types, HMAC, change-ops, editor token | `packages/shared` |
| Drizzle schema; migrations in `hub/apps/api/drizzle` (0000-0004, additive) | `packages/db` |
| Bayesian + frequentist stats, Engagement Score, `decideWinner` gate | `packages/stats` |
| Browser runtime (inline <2KB gz) + tracker + consent | `packages/tracker` (`npm run tracker:build` copies bundles to the API `public` and to the plugin `assets`, which is committed) |
| Visual editor overlay / heatmap overlay | `packages/editor`, `packages/heatmap` (heatmap must not import values from `@tcw/shared`) |
| WordPress plugin | `wp-plugin/tcw-ab-tester` (live-mounted into the dev WordPress, edits take effect at once) |
| Backups | `hub/backup` |

Facts worth knowing: heat data flows tracker -> `heat.ts` `deriveHeatBins` -> `heat_bins`; consent is never decided at render time (page caches), `cfg.consent` is only the fallback and without a consent tool nothing is tracked by design; token kinds `editor` and `heatmap`; `applyDecision` snapshots variants BEFORE finalize deletes anything and records the library item best-effort; winner email claims `tests.winner_notified_at` atomically; retention never deletes pageviews, heat_bins, decisions or library.

## Suggested order for the next session

1. Owner checks the Outcome panel in the dashboard (restore is already done on the dev "Sample Page" test, so it shows the restored state).
2. Owner logs in to wp-admin at the new hostname; walk the element test + editor + goal + winner + permanent rule.
3. Fix the open bugs (admin exclusion and crash recovery first), then the README domain note, then update this file.
4. Run `npm run ci:local` and the Docker build again, commit, and ask the owner before any push or deploy.
