import { z } from "zod";
import { and, eq, type SQL } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { changeOpsSchema } from "@tcw/shared";
import { sites, tests, variants } from "@tcw/db";
import { describeLibraryItem, findPosts, getAnalytics, getHeatmap, getLibraryItem, getResults, getStats, inspectPage, listLibrary } from "@tcw/core";
import { getDb } from "@tcw/core";
import { env } from "../env.js";
import { contextOf, fromService, problem, requireScope, text } from "./common.js";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const STATUSES = ["draft", "qa", "running", "winner_found", "inconclusive", "awaiting_decision", "finalising", "archived"] as const;

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "list_sites",
    { title: "List sites", description: "The WordPress sites connected to the hub, with the ids other tools need.", annotations: READ },
    async (extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      const rows = await getDb().select().from(sites).orderBy(sites.createdAt);
      return text(rows.map((s) => ({ id: s.id, domain: s.domain, displayName: s.displayName, pluginVersion: s.pluginVersion, lastSeenAt: s.lastSeenAt })));
    },
  );

  server.registerTool(
    "list_tests",
    {
      title: "List tests",
      description: "A/B tests, newest first. Filter by site or status.",
      inputSchema: { siteId: z.string().uuid().optional(), status: z.enum(STATUSES).optional() },
      annotations: READ,
    },
    async ({ siteId, status }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      const where: SQL[] = [];
      if (siteId) where.push(eq(tests.siteId, siteId));
      if (status) where.push(eq(tests.status, status));
      const rows = await getDb().select().from(tests).where(where.length ? and(...where) : undefined).orderBy(tests.createdAt);
      return text(rows.reverse().map((t) => ({ id: t.id, name: t.name, type: t.type, status: t.status, siteId: t.siteId, wpPostId: t.wpPostId, permalink: t.wpPermalink, startedAt: t.startedAt, endedAt: t.endedAt })));
    },
  );

  server.registerTool(
    "get_test",
    { title: "Get a test", description: "One test with its variants. For element tests each variant lists its change operations.", inputSchema: { testId: z.string().uuid() }, annotations: READ },
    async ({ testId }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      const [test] = await getDb().select().from(tests).where(eq(tests.id, testId)).limit(1);
      if (!test) return problem("test_not_found (404)");
      const rows = await getDb().select().from(variants).where(eq(variants.testId, testId));
      return text({
        test,
        variants: rows.map((v) => ({ key: v.key, label: v.label, isControl: v.isControl, trafficWeight: v.trafficWeight, wpPostId: v.wpPostId, previewUrl: v.previewUrl, changeOps: changeOpsSchema.catch([]).parse(v.changeOps ?? []) })),
      });
    },
  );

  server.registerTool(
    "get_results",
    {
      title: "Get the verdict and statistics",
      description:
        "The stats engine's view of a test: the recommended winner (or why there is none yet), every gate with pass or fail and its reason, per-variant probability of being best, expected loss, lift with confidence interval, the sample-ratio check, and the confidence trend. This is the authority on whether a difference is real. Use get_analytics for the behaviour behind the numbers.",
      inputSchema: { testId: z.string().uuid() },
      annotations: READ,
    },
    async ({ testId }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      const basic = await getResults(testId);
      if (!basic) return problem("test_not_found (404)");
      const stats = await getStats(testId);
      return text({
        ...basic,
        stats: stats.latest ?? "No statistics computed yet. The worker recomputes hourly once visitors arrive.",
        confidenceTrend: stats.history.slice(-48),
        decision: stats.decision,
      });
    },
  );

  server.registerTool(
    "get_analytics",
    {
      title: "Get detailed analytics",
      description:
        "The behavioural data behind a test, per variant: sessions and visitors, conversion rate, active time (average, median, p90), scroll depth and its distribution, quick-bounce rate, rage clicks, a device breakdown, a day-by-day trend, and goal-level clicks and hovers. Use it to explain why a variant did better or worse, spot device or day effects, and suggest the next test. It is descriptive only: significance comes from get_results.",
      inputSchema: { testId: z.string().uuid() },
      annotations: READ,
    },
    async ({ testId }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      return fromService(await getAnalytics(testId));
    },
  );

  server.registerTool(
    "get_heatmap",
    {
      title: "Get the heatmap findings",
      description:
        "Where visitors click, hover and pay attention on the tested page, as ranked lists of elements (CSS selectors) rather than a picture: most-clicked elements with the hottest spot inside each, most-hovered, key sections actually seen (share of sessions), dead clicks (clicks on things that are not links or buttons, so people expect them to work), rage clicks (frustration), where scrolling pauses, and the scroll drop-off curve with the depth where most people leave. Optionally filter to one variant and one device. Use it to explain why a variant won or lost and to pick the next element to test. Descriptive only: significance comes from get_results.",
      inputSchema: { testId: z.string().uuid(), variantKey: z.string().min(1).max(32).optional(), device: z.enum(["desktop", "tablet", "mobile"]).optional() },
      annotations: READ,
    },
    async ({ testId, variantKey, device }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      return fromService(await getHeatmap(testId, { variantKey, device }));
    },
  );

  server.registerTool(
    "list_library",
    {
      title: "Browse the library of past results",
      description:
        "Every decided test is kept in the cross-site library, whichever site it ran on: what changed, whether it won, the lift and confidence, and tags. Filter by type (page or element), tag, text in the name, or a minimum lift. Use it before proposing a new test: something that won on one site is a strong candidate for another (audiences differ, so re-test rather than assume).",
      inputSchema: {
        type: z.enum(["page", "element"]).optional(),
        tag: z.string().max(40).optional(),
        query: z.string().max(120).optional(),
        minLiftPct: z.number().optional(),
      },
      annotations: READ,
    },
    async ({ type, tag, query, minLiftPct }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      return text(await listLibrary({ type, tag, q: query, minLiftPct }));
    },
  );

  server.registerTool(
    "get_library_item",
    {
      title: "Get a library item",
      description: "One library item in full: the change operations of an element test, or the titles, excerpts and sizes of the page versions, plus the final statistics.",
      inputSchema: { itemId: z.string().uuid() },
      annotations: READ,
    },
    async ({ itemId }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      const item = await getLibraryItem(itemId);
      return item ? text(describeLibraryItem(item)) : problem("library_item_not_found (404)");
    },
  );

  server.registerTool(
    "find_posts",
    {
      title: "Find posts and pages",
      description: "Search a site's posts and pages by title to get the WordPress post id a test needs.",
      inputSchema: { siteId: z.string().uuid(), query: z.string().min(1).max(120), limit: z.number().int().min(1).max(25).default(10) },
      annotations: { ...READ, openWorldHint: true },
    },
    async ({ siteId, query, limit }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      const [site] = await getDb().select().from(sites).where(eq(sites.id, siteId)).limit(1);
      if (!site) return problem("site_not_found (404)");
      try {
        return text(await findPosts(site, query, limit));
      } catch (err) {
        return problem("Could not reach the site's plugin. Is it connected and up to date?", err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "inspect_page",
    {
      title: "Inspect a page",
      description:
        "Fetches a post's public page (server-side, only on that site's own domain) and returns an outline of its text, links, buttons and images with a CSS selector for each. Use these selectors in set_variant_ops. Pass checkSelectors to see how many elements each selector matches before saving it.",
      inputSchema: { siteId: z.string().uuid(), wpPostId: z.number().int().positive(), checkSelectors: z.array(z.string().max(300)).max(20).optional() },
      annotations: { ...READ, openWorldHint: true },
    },
    async ({ siteId, wpPostId, checkSelectors }, extra) => {
      const denied = requireScope(contextOf(extra.authInfo), "hub:read");
      if (denied) return denied;
      try {
        return fromService(await inspectPage(siteId, wpPostId, { selectors: checkSelectors, allowPrivate: env.ALLOW_PRIVATE_SITE_FETCH === "1" }));
      } catch (err) {
        return problem("Could not reach the site's plugin. Is it connected and up to date?", err instanceof Error ? err.message : String(err));
      }
    },
  );
}
