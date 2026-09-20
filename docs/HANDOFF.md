# Handoff: state of the project and how to work in it

Read this, then `docs/PLAN.md` (the design), then `README.md` (setup and the non-obvious design decisions).
Repo: https://github.com/jamesdunnington/tcw-ab-tester (public, default branch **master**).

**All five phases plus the Claude Desktop connector (`docs/MCP-PLAN.md`) are built, tested and pushed. CI is green (last code commit `f90184f`). 240 tests.**
The dev stack (`dev/docker-compose.yml`) has now been built and started under real Docker (2026-09-20): all images build, migrations apply, every plugin file passes `php -l` on PHP 8.2. Nothing has yet been walked through in a real WordPress UI, and nothing has been deployed. Production hostnames: hub `https://test.thecontentwarrior.work`, MCP `https://mcptest.thecontentwarrior.work`. The hub is on a VPS and the WordPress sites are on other servers, so both must reach each other over public HTTPS.

Work continuously without phase-boundary stops. This file is a manual input from the owner: only update it when asked.

## Next, in this order

1. **Shakedown in a real WordPress.** IN PROGRESS. Done: Docker installed (see quirks), stack built and running, first-run bugs fixed (root `.dockerignore`; dev `SECRET_ENCRYPTION_KEY` was 60 chars, needs 64). Still to do: the owner creates the hub admin (http://localhost:5174 First-time setup) and the WordPress install (http://localhost:8080) since the agent must not create accounts or type passwords; then walk the README steps for a page test AND an element test (editor, goal, winner, permanent rule), then the new things below. Known nuisance: MySQL's first start outlasts its 50s healthcheck, so the first `up` reports it unhealthy; wait for healthy and run `up -d` again (or raise `retries`/add `start_period`). Lint is clean but no PHP has executed a request yet, so expect plugin bugs. PHP added since the last shakedown plan:
   - `class-editor-bridge.php`: heatmap mode (`?tcwab_heatmap=TOKEN`, token kinds), `class-hub-client.php` `verify_editor_token($token, $kind)`.
   - `class-runtime.php`: consent is now only a server-side fallback plus a `strict` flag; `class-admin.php`: strict-mode checkbox.
   - `class-variants.php`: `get_post_snapshot`, `create_library_draft`, `search_posts`; `class-finalizer.php`: `apply_rule`, `store_permanent_rule`; `class-rest-api.php`: routes `/posts/{id}/snapshot`, `/library/draft`, `/rules`.
   - Also check: heat data arrives after real visits with a consent plugin active, and the heatmap overlay lines up on a real theme.
2. **Deploy to the VPS**: DNS for `test.` and `mcptest.`, `hub/.env` (see `.env.example`: `MCP_DOMAIN`, optional `SMTP_URL`, `BACKUP_REMOTE` + `RCLONE_CONFIG_OFFSITE_*`). Then verify the connector in Claude Desktop (Settings > Connectors > Add custom connector > `https://mcptest.thecontentwarrior.work/mcp`). Only the SDK's own client has been tested, not Claude's. Watch: Claude's callback host (`ALLOWED_REDIRECT_HOSTS` in `oauth/provider.ts`), token refresh, tool approval prompts. Take one backup by hand and test a restore before trusting it.
3. **Small known gaps:** no TOTP; a permanent rule cannot be removed from the UI (delete its entry in option `tcwab_permanent_rules`); the hub does not re-push permanent rules to a reconnected plugin; SEO-plugin index tables are not purged directly on cleanup; guardrail is click-rate only; raw events are pruned by a batched daily delete, not monthly partitions (deliberate); hover/permanent-rule/heatmap overlay have no automated browser test; the heatmap overlay always paints on the original DOM (for element variants the changed elements may not resolve); the library "permanent" path and draft-post path have only run against a fake WordPress.

## What exists

| Area | Where | State |
|---|---|---|
| Hub API (Fastify, Drizzle) | `hub/apps/api` | auth, sites (+ `/api/sites/:id/posts` title search), tests, variants, `/ingest`, signed WP routes, stats + decision, heatmap, library, editor endpoints |
| Worker | `hub/apps/worker` | Redis Streams ingest -> `processEvent` (events, pageviews, `heat_bins`); BullMQ hourly stats + daily retention; winner email |
| Dashboard (React/Vite) | `hub/apps/dashboard` | login, sites, tests, test detail (results, Heatmap panel, winner flow), Library page (browse, reuse), main nav. Design system: Data-Dense Dashboard, light/dark |
| Claude connector | `hub/apps/mcp` | remote MCP + OAuth 2.1. Tools by scope. read: list_sites, list_tests, get_test, get_results, get_analytics, **get_heatmap, list_library, get_library_item**, find_posts, inspect_page. draft: create_element_test, create_page_test, set_variant_ops, get_editor_link, **apply_library_item**. live (needs confirm): start_test, stop_test, apply_winner, **apply_library_change_permanently** |
| Shared logic | `packages/core` | services: tests, decision (winner flow, snapshots + library record), analytics, **heatmap** (`getHeatData`, `summarizeHeat`, `getHeatmap`), **library**, inspect. Apps hand it their db via `configureCore`; always use `getDb()` |
| Shared types/crypto | `packages/shared` | schemas, HMAC, change-ops, editor token (kinds `editor` and `heatmap`), `HEAT_LAYERS/HEAT_GRID/SCROLL_BINS` |
| DB | `packages/db` | Drizzle schema. Migrations in `hub/apps/api/drizzle` (0000-0004, all additive) |
| Stats | `packages/stats` | Bayesian + frequentist, Engagement Score with the plan's 5 weights (sessions without section data are rescaled to the other 4), `decideWinner` gate |
| Browser runtime | `packages/tracker` | `runtime-inline.ts` (1.62KB gz of 2KB), `tracker.ts` (2.6KB of 8KB), `consent.ts` (live consent: WP Consent API, Complianz, CookieYes) |
| Visual editor | `packages/editor` | vanilla TS, Shadow DOM, `/editor.js` |
| Heatmap overlay | `packages/heatmap` | vanilla TS, Shadow DOM, `/heatmap.js` (3.3KB gz). Imports `EditorApi` from `../../editor/src/api.js`; must NOT import values from `@tcw/shared` (its index pulls in `node:crypto`) |
| WordPress plugin | `wp-plugin/tcw-ab-tester` | connect, duplicate, promote, cleanup, cache purge, archive, SEO guard, editor/heatmap bridge, snapshots, library drafts, rules |
| Backups | `hub/backup` | alpine + pg_dump + rclone, cron via `BACKUP_CRON`; compose service `backup` |
| Compose | `hub/docker-compose.yml` (prod), `dev/docker-compose.yml` (hub + WP) | validated by CI only |

## How things fit (Phase 4 and 5 facts worth knowing)

- **Heat data flow:** tracker click/rage/hover events carry `sel` (from `buildSelector` in `packages/editor/src/selector.ts`), `ox`/`oy` (percent inside the element), clicks carry `dead`. `section_view` events come from an IntersectionObserver. Worker `heat.ts` `deriveHeatBins` maps each event to `heat_bins` rows (layers click, hover, scroll, attention, rage, dead; 10x10 cells; scroll in 5% bands). `pageviews` gained `sections_seen/sections_total`.
- **Token kinds:** `verifyEditorToken(..., kind = "editor")` rejects heatmap tokens; `/editor/renew` uses `"any"`. The plugin does the same via the `k` claim.
- **Consent** is never decided at render time (page caches would freeze it). `cfg.consent` is only the fallback; `cfg.strict` hides variants until consent.
- **Library:** `applyDecision` snapshots variants (page tests) BEFORE finalize deletes anything, then calls `recordLibraryItem` (best effort, never undoes a decision). `library_items` keeps element ops (goals included), snapshots, final stats. Reuse: element/test = draft test + editor link; element/permanent = winners only; page = draft post.
- **Email:** `notify.ts` claims `tests.winner_notified_at` atomically before sending and releases it if the send fails. No `SMTP_URL` = nothing claimed, nothing sent.
- **Retention:** `retention.ts` batched deletes; pageviews, heat_bins, decisions, library are never deleted.

## How to run the checks

```bash
npm ci
npm run ci:local          # build every workspace + all tests (mirrors the Node CI job)
npm run tracker:build     # rebuild browser bundles: copied to hub/apps/api/public (gitignored) and wp-plugin/.../assets (COMMITTED)
```

CI also runs `php -l` over the plugin and `docker compose config` on both compose files, on every push. Counts: core 20, editor 37, heatmap 8, shared 25, stats 58, tracker 16, api 5, mcp 34, worker 37.
Migrations: edit `packages/db/src/schema.ts`, then from `hub/apps/api` run `DATABASE_URL=postgres://x:x@localhost:5432/x npx drizzle-kit generate`. They run automatically when the API container starts. Keep them additive.

## Environment quirks (these cost real time)

- **Docker Desktop is installed on D:** (`D:\Docker\app`; image and VM data in `D:\Docker\wsl`, set via `--wsl-default-data-root`). **C: is nearly full (~22GB): nothing may store there.** `docker.exe` is not on PATH: `$env:Path += ";D:\Docker\app\resources\bin"`, and set `COMPOSE_PROGRESS=plain` for readable build logs (`--progress` is not a valid flag here). There is still no host PHP: lint inside the container, `docker exec dev-wordpress-1 php -l <file>`.
- **The Claude app is an MSIX package**, so its shell sees a redirected `AppData\Local`. Docker Desktop must be launched by the user, not by the agent; the recurring startup error "initializing Secrets Engine ... engine.sock ... cannot be accessed" comes from a stale `AppData\Local\docker-secrets-engine`, and earlier renames of it (`-old-*`) are all still there.
- **Build context is the repo root**, so the root `.dockerignore` (node_modules, dist, generated `hub/apps/api/public`, `.env`) is essential: without it the host's Windows esbuild binary is copied into the Linux image and the build fails.
- **Install everything inside the project** (user requirement): `npm install -w <workspace> <pkg>`; nothing global. Scratch scripts go in the session scratchpad, not `/tmp`.
- **Stale `dist`:** other workspaces import `@tcw/shared`, `@tcw/db`, `@tcw/stats`, `@tcw/core` from their built `dist`. After changing one, rebuild it (`npm run build -w @tcw/<name>`) before testing dependents. The root build order is explicit for the same reason.
- **Shell heredocs:** break past roughly 150 lines ("unexpected EOF"), and they MANGLE BACKSLASHES (`\n` became a real newline, `\d` became `d` in PHP). Use the Write/Edit tools for anything with escapes or regexes, or write a patch script file with Write and run it with node.
- **GateGuard hook:** the first Write/Edit of each file per session is refused once and asks for importers, affected API, data shape and the verbatim instruction. State them briefly, then retry the identical call. Bash edits bypass it.
- **CRLF:** git converts checked-out files to CRLF here. Patch scripts matching multi-line strings must normalise line endings first. `.gitattributes` forces LF for `*.sh` (Docker scripts).
- Recursive forced deletes are blocked by a hook, and it also fires on any command whose text merely mentions one.
- **Commit and push after each unit of work** (the project folder and repo were once deleted by accident). Then confirm CI: `gh run watch <id> --exit-status`. jsdom 25 is pinned at the root (CI is Node 20).
- **Browser checks:** the built-in browser works. Run `npx vite preview --port 4173` in the dashboard (proxies `/api` to 4000), point a throwaway mock API at 4000 (and a fake WordPress page on 4174 for the overlays), then STOP them afterwards (PowerShell: kill listeners on those ports). Native `<select>` cannot be driven by the automation; set the value via JS and dispatch `change`.
- `gh` is signed in as `jamesdunnington`.
- **Hub SQL runs in tests** with PGlite (`@electric-sql/pglite`, dev dependency of `@tcw/mcp` and `@tcw/worker`) using the real migrations. Extend `hub/apps/mcp/src/__tests__/e2e.test.ts` (fake WordPress on loopback, real OAuth) or `hub/apps/worker/src/__tests__/jobs.test.ts` rather than mocking the db.
- **MCP SDK 1.30 facts:** imports `zod/v4`; PKCE verified in our `service.exchangeCode`; an invalid access token must throw `InvalidTokenError` to get a 401; `registerTool` without an inputSchema calls the handler with `(extra)` only.

## Conventions worth keeping

- Commit messages explain the why; end with the Co-Authored-By line from the session.
- UI work: use the `ui-ux-pro-max` skill; verify at desktop and 375px, light and dark.
- Test statistics against textbook reference values, not against the implementation itself.
- Site secrets are encrypted, not hashed. The browser only ever knows the public site key. See README "Why some things are built the way they are".
- Ops are a closed, validated set (text, html, style, attr, hide, goal); no custom JS op.
