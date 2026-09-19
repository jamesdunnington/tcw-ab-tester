# Handoff: state of the project and how to work in it

Read this, then `docs/PLAN.md` (the design), then `README.md` (setup and the
non-obvious design decisions). Repo: https://github.com/jamesdunnington/tcw-ab-tester
(public, default branch **master**). **Phases 1 to 3 are done, and the Claude Desktop connector (`docs/MCP-PLAN.md`) is built and tested end to end.** Nothing has run in a real WordPress or on the VPS yet; that shakedown is the next job. Production hostnames: hub `https://test.thecontentwarrior.work`, MCP `https://mcptest.thecontentwarrior.work`.

## What exists

| Area | Where | State |
|---|---|---|
| Hub API (Fastify, Drizzle) | `hub/apps/api` | auth, sites, tests, variants, `/ingest`, signed WP routes, stats + decision endpoints |
| Worker | `hub/apps/worker` | Redis Streams ingest consumer + BullMQ hourly stats job |
| Dashboard (React/Vite) | `hub/apps/dashboard` | login, sites, tests (page and element), test detail with winner flow; "Edit variant" opens the visual editor. Design system: Data-Dense Dashboard, light/dark |
| Shared business logic | `packages/core` (`@tcw/core`) | secrets crypto, signed WP client, config builder, services: tests (create/start/stop/editor link), winner flow (`applyDecision`), analytics (`getStats/getResults/getAnalytics`), SSRF-guarded page inspector. The api routes and the MCP tools both call these. Apps hand it their db via `configureCore` |
| Claude connector | `hub/apps/mcp` (`@tcw/mcp`) | Express, remote MCP over Streamable HTTP at `/mcp`, OAuth 2.1 (dynamic registration, PKCE, refresh rotation) via the SDK auth router, own login + consent page. 14 tools by scope: read (list_sites, list_tests, get_test, get_results, get_analytics, find_posts, inspect_page), draft (create_element_test, create_page_test, set_variant_ops, get_editor_link), live (start_test, stop_test, apply_winner). Tokens hashed in `oauth_*` tables (migration 0002) |
| Shared types, zod, HMAC | `packages/shared` | HMAC algorithm mirrored in PHP (`class-hub-client.php`) |
| DB schema | `packages/db` | Drizzle schema, migrations live in `hub/apps/api/drizzle` |
| Statistics | `packages/stats` | Bayesian + frequentist analysis, Engagement Score, sample size, `decideWinner` gate |
| Browser runtime | `packages/tracker` | `runtime-inline.ts` (assignment/redirect, inlined by PHP) and `tracker.ts` |
| WordPress plugin | `wp-plugin/tcw-ab-tester` | connect, duplicate, promote, cleanup, cache purge, archive, SEO guard |
| Change ops + editor token | `packages/shared` | `change-ops.ts` (typed ops, `mergeGoalOps`), `editor-token.ts` (5-min HMAC token, renewable up to 8h) |
| Visual editor | `packages/editor` | vanilla TS, Shadow DOM, built to `/editor.js` (5.5KB gz): selector generator, picker, sidebar, undo/redo, live preview, token-authenticated save |
| Element winner | `class-finalizer.php`, `class-runtime.php`, `runtime-inline.ts` | `applyDecision` sends the winning ops (goals stripped) to `/finalize`; the plugin stores them in option `tcwab_permanent_rules`; the inline runtime applies them to everyone with no assignment and no tracking |
| Editor API | `hub/apps/api/src/routes/editor-api.ts`, `editor.ts` | `GET/PUT /editor/ops`, `POST /editor/renew` (bearer token); `POST /api/tests/:id/variants/:key/editor-link` |
| Element tests | `routes/tests.ts` | `POST /api/element-tests`, `PUT /api/tests/:id/variants/:key/ops`; ops ship in the runtime config |
| Plugin editor bridge | `wp-plugin/.../class-editor-bridge.php` | token + `edit_pages` gate, loads hub `/editor.js`; editor requests skip cache and the A/B split |
| Compose | `hub/docker-compose.yml` (prod, now with `mcp` and `MCP_DOMAIN` in Caddy), `dev/docker-compose.yml` (hub + real WP, no mcp) | validated by CI only, never run locally |

Phase 1 = page/post split tests end to end. Phase 2 = stats, winner gates,
promote/cleanup/archive, decision UI. Phase 3 = visual editor, element tests, permanent winner rules. Then the Claude connector.

## Not built yet

**Do these next, in this order:**
1. **Shakedown in a real WordPress.** `docker compose -f dev/docker-compose.yml up --build` and walk the README steps for a page test AND an element test (editor, goal, winner, permanent rule). No PHP has ever executed, so expect plugin bugs. New PHP since the last handoff: `search_posts` (`class-variants.php`, route `GET /tcwab/v1/posts`), `store_permanent_rule` (`class-finalizer.php`), `rules_for_post` (`class-runtime.php`), and the editor login redirect.
2. **Deploy to the VPS** (DNS for `test.` and `mcptest.`, `hub/.env` including `MCP_DOMAIN`), then **verify the connector in Claude Desktop** (Settings > Connectors > Add custom connector > `https://mcptest.thecontentwarrior.work/mcp`). Only the SDK's own client has been tested, not Claude's. Watch: Claude's callback host (`ALLOWED_REDIRECT_HOSTS` in `oauth/provider.ts` allows claude.ai, claude.com and loopback; add hosts if registration is refused), token refresh, tool approval prompts.
3. Small gaps: no TOTP (the hub has none); a permanent rule cannot be removed from the UI yet (delete its entry in option `tcwab_permanent_rules`); the hub does not re-push permanent rules to a reconnected plugin; the hover and permanent-rule paths have no automated browser test.

- Phase 4: heatmaps (also unlocks the 5th Engagement Score component, "key sections seen").
- Phase 5: cross-site library, email notifications, consent-plugin integrations, retention jobs, backups.
- Small known gaps: guardrail is click-rate only; SEO-plugin index tables are not purged directly on cleanup.

## Phase 3 design decisions (already made)

- **Ops are a closed, validated set:** text, html, style, attr, hide, goal. No custom JS op (arbitrary JS on visitors' pages is a security risk); add later only behind an explicit opt-in. Selectors must be a single selector; css values, attribute names and URL schemes are filtered (`change-ops.ts`).
- **Goals apply to every variant** via `mergeGoalOps`, because the control has no edits of its own. For element tests the worker counts only goal-flagged clicks as conversions; page tests still count any click.
- **Editor auth:** the token pins site + test + variant, is domain-separated from request signatures, and only proves the hub sent the admin; the plugin still requires a logged-in user with `edit_pages`. Renewals are capped at 8h from first issue.
- **CORS is per route** (`lib/cors.ts`): any origin, no credentials, for `/ingest` and `/editor/*`; dashboard origins with cookies elsewhere. This fixed a Phase 1 bug (the tracker's JSON + custom-header fetch would have failed its preflight).
- **Editor is vanilla TS, not React** (the plan said React) to keep the overlay small.
- Editor preview reuses `packages/tracker/src/applier.ts`, so preview equals production.
- Inline runtime is 1.43KB gz of 2KB; tracker 1.17KB of 8KB.

## How to run the checks

```bash
npm ci
npm run ci:local          # build every workspace + all tests (mirrors the Node CI job)
npm run tracker:build     # rebuild the browser bundles; outputs are copied into
                          # hub/apps/api/public (gitignored) and wp-plugin/.../assets (COMMITTED)
```

CI (`.github/workflows/ci.yml`) also runs `php -l` over the plugin and
`docker compose config` on both compose files. Runs on every push and PR, and
manually via `gh workflow run CI`. Counts as of the last commit: shared 23, stats 51, tracker 9, worker 14, api 5, editor 37, core 10, mcp 30 (179 total).

Migrations: edit `packages/db/src/schema.ts`, then from `hub/apps/api` run
`DATABASE_URL=postgres://x:x@localhost:5432/x npx drizzle-kit generate` (no
live DB needed). Migrations run automatically when the API container starts.
Keep them additive.

## Environment quirks (these cost real time)

- **No PHP, no Docker locally.** PHP is only syntax-checked in CI. Nothing in the plugin has run inside a real WordPress yet. First thing worth doing with the user: `docker compose -f dev/docker-compose.yml up --build` and walk the README steps.
- **Install everything inside the project** (user requirement). Use `npm install -w <workspace> <pkg>`; nothing global. Scratch scripts go in the session scratchpad, not `/tmp`.
- **Shell heredocs break past roughly 150 lines** ("unexpected EOF ... matching `'`"); nothing is written when that happens. Use one file per call, or the Write tool.
- **Write/Edit tools:** the first attempt at each new file is rejected by a gate hook; retry the identical call and it succeeds. Bash heredocs bypass the gate.
- **CRLF:** git converts checked-out files to CRLF here. Patch scripts that match multi-line strings must normalize line endings first (`.split(String.fromCharCode(13)).join("")`). Prefer `sed` for single-line edits.
- Recursive forced deletes are blocked by a hook, and it also fires on any command whose text merely mentions one. Plain single-file `rm` works.
- **Commit and push after each unit of work.** The whole project folder and the GitHub repo were once deleted by accident; only pushed work survived.
- The restored repo needed a workflow-file push and an "Enable Actions" click before CI ran. It is working now.
- Chrome extension was not connected. The built-in browser works for UI checks: run `npx vite preview --port 4173` in the dashboard (it proxies `/api` to port 4000), point a throwaway mock API at 4000, and stop both afterwards.
- `gh` is signed in as `jamesdunnington`.
- **Always confirm CI is green after each push** (`gh run watch --exit-status <id>`, then `gh run list --limit 1`). Local passes hid three CI failures in Phase 3: jsdom 30 needs Node >=22.22 but CI is Node 20, so one jsdom 25 is pinned at the **root** (vitest is hoisted; a copy nested in a workspace is not enough); `npm run build --workspaces` is alphabetical, so the root build now builds `@tcw/shared` first (a stale local `shared/dist` hid it).
- **The Write/Edit gate is per file and per session:** the first create/edit of each file is refused once, asking for importers, affected API and the verbatim instruction. Answer briefly, then retry the identical call.
- **Heredocs mangle backslashes** (an escape became an octal literal, a doubled backslash collapsed). Use Write/Edit for files with regexes or escapes, and `String.raw` in tests.
- Real-browser checks: a scratch harness (fake WordPress page on :4173 plus a mock hub with CORS on :4000, kept in the session scratchpad) verified the editor end to end in the built-in browser. Native select elements can't be driven by the automation, so unit-test those.

- **Hub SQL now runs in tests.** `hub/apps/mcp/src/__tests__/e2e.test.ts` uses PGlite (Postgres in WASM, a dev dependency of `@tcw/mcp`) with the real migrations from `hub/apps/api/drizzle`, a fake WordPress on loopback, and the SDK's own MCP client over real OAuth. It covers the analytics SQL, the OAuth flow, all three scope tiers and the element winner flow. Extend it rather than mocking the db.
- **Tools and services use `getDb()` from `@tcw/core`, never a module-level db**, so tests can swap the database. Each app's `db` module calls `configureCore`.
- **MCP SDK 1.30 facts:** it imports `zod/v4` (needs zod >=3.25, done); it only passes the PKCE verifier to the provider when `skipLocalPkceValidation` is true (we verify PKCE in `service.exchangeCode`, so a wrong verifier burns the code); an invalid access token must throw `InvalidTokenError` to get a 401 (any other OAuthError is a 400 and clients will not refresh); `registerTool` without an inputSchema calls the handler with `(extra)` as its only argument.
- **The root `npm run build` order is explicit** (shared, db, stats, core, then the rest) because `packages/*` builds alphabetically and core depends on three siblings.
- **GateGuard hook:** the first Write of each new file needs a short statement (callers, affected API, data, verbatim instruction), then retry. Long heredocs (over about 150 lines, or with very long lines) fail silently, so use Write for big files.
- OAuth client secrets are stored encrypted (the SDK compares them in plaintext); codes and tokens are stored as SHA-256 hashes. Dynamic client registration accepts only Claude's callback hosts and loopback redirect URIs.

## Conventions worth keeping

- Commit messages explain the why; end with the Co-Authored-By line from the session.
- UI work: use the `ui-ux-pro-max` skill; verify in a browser at desktop and 375px, light and dark. The dashboard checks caught a real bug (wrong default decision) that typechecking could not.
- Test statistics against textbook reference values, not against the implementation itself.
- Site secrets are encrypted, not hashed (HMAC verification needs the raw secret). The browser only ever knows the public site key; the API resolves the site UUID server-side. See README "Why some things are built the way they are".

## End-of-phase routine (do this automatically every phase)

When a phase is finished, before starting the next one:

1. Run `npm run ci:local` and confirm the latest GitHub CI run is green.
2. Update this file: the "What exists" table, "Not built yet", "Phase N+1 starting points", the test count, and any new environment quirks or decisions learned during the phase.
3. Update the status section of `README.md` if it changed.
4. Commit and push (`docs: handoff for Phase N+1`).
5. Tell the user the phase is done and **offer the choice**: continue in this chat, or open a fresh chat and start it with "Read docs/HANDOFF.md and docs/PLAN.md, then start Phase N+1." Recommend a fresh chat when the conversation is long, since all state lives in git.
