# TCW A/B Tester: System Plan

## Context
You want to A/B test **elements** (CTA, colour, text, styling) and **whole pages/posts** on several WordPress sites. Winners are judged on **engagement**, not page views: active time on page, scroll depth, where people stop scrolling, hovering, and clicking on elements. When a test has a clear winner, the system asks you to (1) keep the new version or go back to the old one, and (2) delete the losing copy or not. Deleting removes every trace of the losing copy from WordPress. A record of the test is always kept so you can reuse the result on other sites.

**Decisions you made:**
- A visual point-and-click editor for element variants.
- Your sites use Gutenberg and the Classic editor.
- The design must still work with page caching and CDNs.
- A **central hub on your VPS**: Docker, Node.js and React, holding all data and all management screens.
- Browser events go **directly to the hub**. WordPress only runs the tests.
- 5 to 20 sites and under 500k visits a month, so PostgreSQL alone is enough.
- GDPR consent is respected.

The project folder `D:\Vibe Coding\TCW AB Tester` is empty, so this is a new build.

---

## 1. Architecture

```
 Visitor browser ──(tracker.js events, sendBeacon)──►  HUB (VPS, Docker)
      ▲                                               ├─ caddy     (HTTPS, reverse proxy)
      │ page + inline runtime snippet                 ├─ api       (Node/Fastify/TS: admin API + /ingest)
 WordPress site + TCW plugin ◄──(HMAC-signed REST)──► ├─ worker    (BullMQ: event flush, aggregation, stats, cleanup)
                                                      ├─ dashboard (React/Vite: all management UI)
                                                      ├─ postgres  (config, events, aggregates, archive)
                                                      └─ redis     (ingest buffer, queues, config cache)
```

**The WordPress plugin is a small agent.** It connects to the hub, receives the test config, adds the runtime snippet to pages, creates, promotes and deletes variant posts when the hub asks it to, runs the visual editor bridge, and keeps a small local archive of past tests.

**The hub does everything else.** It creates tests, runs the visual editor sessions, stores events, computes the statistics, shows heatmaps and dashboards, asks you to confirm the winner, and keeps the cross-site library.

## 2. Repository layout (monorepo)
```
TCW AB Tester/
  hub/
    docker-compose.yml, docker-compose.dev.yml, .env.example, Caddyfile
    apps/api/          Fastify + TypeScript, Drizzle ORM, zod validation
    apps/worker/       BullMQ jobs
    apps/dashboard/    React + Vite + TanStack Query + Recharts; heatmap overlay
    packages/shared/   types, zod schemas, the "change-operation" schema
    packages/stats/    pure-TS statistics library (heavily unit-tested)
    packages/tracker/  browser runtime + tracker, built to one small IIFE (<8KB gz)
    packages/editor/   visual editor overlay (React, loaded only in editor mode)
  wp-plugin/tcw-ab-tester/
    tcw-ab-tester.php, uninstall.php
    includes/ class-hub-client.php   (signed calls to hub, config cache)
              class-rest-api.php     (signed endpoints the hub calls)
              class-runtime.php      (injects the inline snippet + config into <head>)
              class-variants.php     (duplicate / promote / delete posts)
              class-cleanup.php      (the "remove all traces" routine)
              class-seo-guard.php    (noindex, canonical, sitemap/search exclusion)
              class-cache-purge.php  (WP Rocket, LiteSpeed, W3TC, Cloudflare, core)
              class-editor-bridge.php(token check + load editor/heatmap overlay)
              class-archive.php      (local archive table)
    admin/   one settings page: connect to hub (URL + site key + secret), status, archive list
  dev/  local WordPress + MySQL compose for testing, traffic simulator
```

## 3. How visitors are split between variants (cache-safe)
- The plugin puts a **small synchronous inline script** plus the active test config (JSON) into `<head>`. Because the config is part of the cached HTML, caching works. When a test changes, the plugin purges the affected URLs through `class-cache-purge.php`.
- **Assignment:** each visitor gets an anonymous first-party ID (`tcwab_vid`, a random UUID). The variant is `hash(visitor_id + test_id) mod 100`, checked against the traffic split. That keeps assignment sticky and deterministic, and it is stored in the `tcwab_asg` cookie.
- **Element tests:** the runtime applies the change operations to the DOM right away. To prevent flicker, it hides **only the target elements** (not the whole page), with a 400ms safety timeout. A MutationObserver re-applies the changes to content that loads late.
- **Page/post tests:** the variant is its own post at a hidden URL. The runtime runs `location.replace()` to that URL before the page paints and keeps query strings and UTM parameters. The variant page has `canonical` pointing to the original and `noindex`, so SEO is safe. Bots, logged-in editors and `?tcwab_force=a|b` (for QA) are excluded from the split.
- **Exclusions:** bots (user-agent list, headless detection, no-interaction sessions), admins and editors, and optional IP ranges.
- **Consent:** the plugin integrates with the WP Consent API, Complianz and CookieYes. The default mode assigns the variant with a functional cookie, but **no tracking events are sent until statistics consent is given**. Visitors who have not consented are only counted, for the sample-ratio check. A strict mode shows everyone version A until they consent. No personal data is stored. IPs are only used for bot and geo filtering and are never saved.

## 4. What is tracked (engagement only)
`tracker.js` batches events and sends them with `navigator.sendBeacon` every 5s and on `visibilitychange`/`pagehide`. Events go to `POST https://hub/ingest`, which checks the site key, origin and rate limit.

| Signal | How it is measured |
|---|---|
| **Active time** | Only counts while the tab is visible AND there was input or scrolling in the last 5s (heartbeat every 5s). Raw time on page is not used. |
| **Scroll depth** | Maximum % of the content reached (relative to the content container, not the footer). |
| **Scroll stops** | Positions where the viewport rested for ≥1.5s. Feeds the attention heatmap and shows what people actually read. |
| **Element visibility** | IntersectionObserver ≥50% visible. Records the time each target element was on screen. |
| **Hover intent** | Mouseover on a target lasting ≥500ms (desktop only). Records the duration. |
| **Clicks** | Clicks on targets and goal elements. All clicks, stored with element-relative coordinates, for the click heatmap. |
| **Negative signals** | Rage clicks (3+ in 1s), dead clicks, quick bounce (<5s active time, no scroll). |

Heatmap coordinates are stored as **selector + % offset inside that element**, plus the device class (desktop, tablet, mobile), so maps still line up when the layout is responsive.

## 5. Scoring & statistics (`packages/stats`)
**Engagement Score (0–100 per pageview).** The weights are configurable per test, with presets:

| Component | CTA preset | Content/Post preset | Landing preset |
|---|---|---|---|
| Active time ÷ expected read time (words/230 wpm), capped at 1 | 15 | 35 | 25 |
| Scroll depth reached | 10 | 25 | 20 |
| Attention: share of key sections seen ≥1s | 10 | 20 | 15 |
| Hover intent on target | 15 | 5 | 10 |
| Click / goal on target | 50 | 15 | 30 |

A quick bounce scores 0, and each rage click subtracts 5. Each component is also reported separately, so you can see *why* a variant won.

**Analysis (Bayesian decision rule plus frequentist confirmation):**
- **Binary metrics** (clicked the CTA, engaged session): a Beta-Binomial posterior. P(B > A) and the **expected loss** come from Monte Carlo sampling (100k draws).
- **Continuous metrics** (Engagement Score, active time): active time is log-transformed and outliers above the 99th percentile are winsorised. The posterior uses a normal approximation, with a Bayesian bootstrap for small samples. Welch's t-test and Mann-Whitney U are shown as confirmation, along with a 95% CI for the relative lift.
- **Sample Ratio Mismatch** check (chi-square, p < 0.001 → the test is flagged as broken and no winner is declared).
- **Pre-launch sample-size calculator** (based on baseline and minimum detectable effect), which sets the minimum N.
- **A/B/n support:** with more than 2 variants, P(best) is computed across all of them, and the frequentist p-values get a Holm-Bonferroni correction.

**A winner is declared only when all of these hold:**
- P(best) ≥ 95% (configurable) on the primary metric
- expected loss < 1% of baseline
- the minimum sample per variant has been reached
- the test has run ≥ 7 full days (a whole weekly cycle)
- the SRM check passes
- no guardrail metric (such as bounce rate) is significantly worse

The worker recomputes the statistics every hour and saves results snapshots, so you get a trend chart of how confident the result is over time.

## 6. Test lifecycle & the winner flow
`draft → QA (force-preview links) → running → winner_found | inconclusive (max duration hit) → awaiting_decision → finalising → archived`

1. **Winner found.** The dashboard shows a banner, and email notification is optional. You see the result, the charts and the heatmaps side by side.
2. **Prompt 1:** "Use **B (winner)** or keep **A (original)**?" You can go against the recommendation, and the reason is logged.
3. **Prompt 2:** "Delete the redundant copy?" Yes or no.
4. **Page/post tests, when you apply B:** the plugin **copies B into A's post ID**: content, title, excerpt, template, featured image, and SEO meta (Yoast/RankMath). The URL, comments and SEO history stay intact. A revision of A is saved first so you can roll back.
5. **Element tests, when you apply B:** the change set becomes a **permanent rule** served to 100% of visitors with no tracking. For simple text or colour changes inside Gutenberg `post_content`, there is an optional "bake into content" step.
6. **Delete redundant = yes.** `class-cleanup.php` removes:
   - the variant post (`wp_delete_post($id, true)`), its revisions, postmeta and term relationships
   - its menu items
   - attachments used **only** by the variant (a usage check runs first)
   - plugin options and transients
   - SEO plugin index rows (Yoast indexables, RankMath)

   It then purges the caches and reports a **cleanup manifest** (what was deleted) back to the hub.
7. **Delete = no:** the losing variant is set to `draft`, tagged, and hidden.
8. **Archive.** The hub keeps the full record permanently:
   - the hypothesis and config
   - a **snapshot of both variants** (HTML, content, change set), so it can be reused after deletion
   - final statistics and heatmap aggregates
   - the decision: who made it, when, and why
   - the cleanup manifest

   WordPress keeps a local `wp_tcwab_archive` row (test name, dates, winner, lift, confidence, link to the hub), so each site records that the test existed.

## 7. Visual editor & heatmap overlay
- In the hub, you click "Edit variant". The hub creates a **short-lived signed token** (5 min, HMAC) and opens `https://site/page?tcwab_editor=TOKEN`.
- The plugin checks the token signature, **and** that the user is a logged-in WordPress user with `edit_pages`. It then loads `editor.js` from the hub as an overlay (in a Shadow DOM, so the site's CSS does not interfere).
- **Element picking:** hover highlights an element and a click selects it. The editor builds a robust selector (id → stable data attributes → class + nth-of-type path) and a **fallback fingerprint** (tag + text + position), so the change still applies after small theme changes.
- **Sidebar edits:**
  - text or inner HTML
  - colours, background, font, size, spacing, border radius
  - link URL
  - hide or show
  - swap image
  - custom CSS or JS scoped to the element
  - a "goal" flag

  Edits are saved as typed **change operations** (`packages/shared`), and the editor has undo and redo.
- **Device preview toggle** (desktop, tablet, mobile widths).
- The **heatmap view** reuses the same overlay on the live page and draws click, hover, scroll-stop and attention layers (simpleheat), filtered by variant, device and date. No screenshot service is needed.

## 8. Hub data model (PostgreSQL)
- **Config and archive tables:** `users`, `sites` (domain, site_key, hashed secret), `tests` (type, status, split, preset, weights, thresholds), `variants` (post_id or change_ops, snapshot), `goals`, `decisions`, `library_items`, `audit_log`.
- **`assignments`:** visitor, test, variant, device, first_seen.
- **`pageviews`:** one row per view with the computed metrics and score. The worker fills it from the events.
- **`events`:** **partitioned monthly** by timestamp. Raw events are kept for 90 days, then dropped by partition.
- **`agg_daily`** (per variant, per metric) and **`heat_bins`** (selector, grid cell, device, count) are kept forever.
- **Ingest path:** `/ingest` → Redis stream → the worker batch-inserts into Postgres with `COPY`. That handles about 500k visits a month on a small VPS.

## 9. Security
- Hub admin login: argon2 password hash plus optional TOTP. Sessions use httpOnly cookies. Every action is written to the audit log.
- Hub ↔ WordPress: **HMAC-SHA256 signed requests** (timestamp + nonce, 5-min window) using the per-site secret.
- WordPress REST routes use `permission_callback` with the signature check. Destructive calls (promote or delete) need a decision ID from the hub, and the plugin double-checks it.
- The ingest endpoint validates the site key against the Origin/Referer header, validates payloads with zod, caps payload size, and rate-limits per IP hash.
- The plugin sanitises and escapes all input and output, and uses nonces on its settings page. `uninstall.php` removes the plugin's own tables and options only when you choose to.

## 10. Cross-site reuse (the library)
Every archived test becomes a **library item** in the hub, searchable by type, tags and lift.
- **"Apply to another site":** for element tests, the change set is cloned and opened in the editor on the target site to confirm or re-map selectors. For page tests, the winning content snapshot is pushed as a **draft post** to the target site through the signed REST API.
- The reused change can go live straight away as a permanent change, or be started as a **new test** there (recommended, because audiences differ).

## 11. Build phases
1. **Foundation:**
   - hub Docker stack, auth, site registration
   - the plugin's connection and signed REST
   - runtime snippet, assignment, tracker, ingest pipeline
   - **page/post split tests** end to end (duplicate → run → basic results)
2. **Stats & decisions:** `packages/stats`, Engagement Score, winner rules, SRM, the sample-size calculator, the winner flow, promote/cleanup/archive, cache purge.
3. **Visual editor & element tests:** the editor overlay, change-operation runtime, anti-flicker, goals.
4. **Heatmaps:** the click, hover, scroll-stop and attention layers, and the heat_bins aggregation.
5. **Library & polish:** cross-site apply, email notifications, consent integrations, retention jobs, backups (`pg_dump` cron to off-box storage).

## 12. Verification
- **Unit tests:** `packages/stats` (Vitest), checked against reference values from SciPy/R for Beta posteriors, Welch, Mann-Whitney and chi-square. There are also tests for the change-operation runtime and the selector generator (jsdom). PHPUnit covers `class-variants`, `class-cleanup` (asserts no orphaned rows, meta or attachments are left) and signature checks.
- **Simulator** (`dev/simulator`): Playwright bots browse the local dev WordPress with a known built-in effect.
  - **A/A tests** must produce a false-positive rate of ≤5% over repeated runs.
  - **A/B tests** with a real lift must be detected within the expected sample size.
- **End-to-end:** start `docker compose -f docker-compose.dev.yml up` (hub + WordPress + MySQL), connect the plugin, then check:
  - create a page test and confirm the 50/50 split and redirect with a cache plugin active
  - run the simulator
  - reach a winner, apply B and delete A
  - confirm the original URL shows B's content, the variant post and its meta are gone, and the archive row exists in both WordPress and the hub
- **Performance:** runtime snippet under 2KB inline, tracker under 8KB gzipped, no measurable change to LCP or CLS (Lighthouse before and after).
