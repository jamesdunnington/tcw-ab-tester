import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { changeOpsSchema, type ChangeOp } from "@tcw/shared";
import { libraryItems, sites, tests, variants } from "@tcw/db";
import { getDb } from "../context.js";
import { fail, ok, type ServiceResult } from "../result.js";
import { createLibraryDraft, fetchPostSnapshot, pushPermanentRule, type SiteRow, type WpPostSnapshot } from "../wp-client.js";
import { createElementTest, createEditorLink } from "./tests.js";

type Test = typeof tests.$inferSelect;
type Variant = typeof variants.$inferSelect;
export type LibraryItem = typeof libraryItems.$inferSelect;

/** What a page-test snapshot holds per variant. */
export interface VariantSnapshot {
  label: string;
  isControl: boolean;
  title: string;
  content: string;
  excerpt: string;
}

/**
 * Takes a copy of every variant's post BEFORE the winner flow deletes anything, so the test can still be
 * reused afterwards. Best effort: a variant that cannot be read is left out and the decision still goes ahead.
 */
export async function snapshotVariants(site: SiteRow, test: Test, variantRows: Variant[]): Promise<Record<string, VariantSnapshot>> {
  const out: Record<string, VariantSnapshot> = {};
  for (const v of variantRows) {
    const postId = v.isControl ? test.wpPostId : v.wpPostId;
    if (!postId) continue;
    try {
      const s: WpPostSnapshot = await fetchPostSnapshot(site, postId);
      out[v.key] = { label: v.label, isControl: v.isControl, title: s.title, content: s.content, excerpt: s.excerpt };
    } catch {
      /* the plugin may be older than this feature; the item is still recorded, just not re-usable as a page */
    }
  }
  return out;
}

type StoredStats = { variants?: Array<{ key: string; pBest?: number; sessions?: number; lift?: { estimate: number | null } | null }> } | null;

/** Pure: the numbers a library item keeps from the final stats snapshot. */
export function summarizeOutcome(stats: StoredStats, chosenKey: string): { liftPct: number | null; pBest: number | null; sessions: number } {
  const vs = stats?.variants ?? [];
  const chosen = vs.find((v) => v.key === chosenKey);
  const lift = chosen?.lift?.estimate;
  return {
    liftPct: typeof lift === "number" ? Math.round(lift * 10_000) / 100 : null,
    pBest: typeof chosen?.pBest === "number" ? chosen.pBest : null,
    sessions: vs.reduce((n, v) => n + (v.sessions ?? 0), 0),
  };
}

/** Pure: default tags, so the library is browsable before anyone tags anything by hand. */
export function autoTags(test: Pick<Test, "type" | "wpPostType">, ops: ChangeOp[]): string[] {
  const tags = new Set<string>([test.type, test.wpPostType]);
  for (const o of ops) {
    if (o.op === "text" || o.op === "html") tags.add("copy");
    else if (o.op === "style") tags.add("style");
    else if (o.op === "hide") tags.add("removal");
    else if (o.op === "attr") tags.add("link-or-attribute");
  }
  return [...tags];
}

const cleanTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
export const cleanTags = (tags: string[]): string[] => [...new Set(tags.map(cleanTag).filter(Boolean))].slice(0, 20);

/** Called by the winner flow once a decision is stored. Idempotent per test. */
export async function recordLibraryItem(args: {
  test: Test;
  site: SiteRow;
  variantRows: Variant[];
  chosen: Variant;
  finalStats: unknown;
  snapshots: Record<string, VariantSnapshot>;
}): Promise<void> {
  const { test, site, variantRows, chosen } = args;
  const challenger = variantRows.find((v) => !v.isControl);
  const ops = test.type === "element" ? changeOpsSchema.catch([]).parse((challenger ?? chosen).changeOps ?? []) : [];
  const stats = summarizeOutcome(args.finalStats as StoredStats, chosen.key);
  const values = {
    testId: test.id,
    sourceSiteId: site.id,
    sourceDomain: site.domain,
    name: test.name,
    type: test.type,
    wpPostType: test.wpPostType,
    tags: autoTags(test, ops),
    outcome: chosen.isControl ? "kept_original" : "applied_variant",
    winnerKey: chosen.key,
    winnerLabel: chosen.label,
    liftPct: stats.liftPct === null ? null : String(stats.liftPct),
    pBest: stats.pBest === null ? null : String(stats.pBest),
    sessions: stats.sessions,
    changeOps: test.type === "element" ? ops : null,
    snapshots: test.type === "page" && Object.keys(args.snapshots).length > 0 ? args.snapshots : null,
    finalStats: args.finalStats ?? null,
  };
  const { tags: _tags, ...refresh } = values; // a re-run refreshes the record but keeps hand-edited tags
  await getDb().insert(libraryItems).values(values).onConflictDoUpdate({ target: libraryItems.testId, set: refresh });
}

export interface LibraryFilters {
  type?: "page" | "element";
  tag?: string;
  q?: string;
  siteId?: string;
  /** Only items whose winner lifted the metric by at least this many percent. */
  minLiftPct?: number;
}

/** Newest first, without the heavy fields (snapshots and final stats): those come from getLibraryItem. */
export async function listLibrary(filters: LibraryFilters = {}) {
  const where: SQL[] = [];
  if (filters.type) where.push(eq(libraryItems.type, filters.type));
  if (filters.siteId) where.push(eq(libraryItems.sourceSiteId, filters.siteId));
  if (filters.tag) where.push(sql`${libraryItems.tags} @> ${JSON.stringify([cleanTag(filters.tag)])}::jsonb`);
  if (filters.q) where.push(sql`${libraryItems.name} ilike ${"%" + filters.q.replace(/[%_\\]/g, (c) => "\\" + c) + "%"}`);
  if (typeof filters.minLiftPct === "number") where.push(gte(libraryItems.liftPct, String(filters.minLiftPct)));
  const rows = await getDb()
    .select({
      id: libraryItems.id,
      name: libraryItems.name,
      type: libraryItems.type,
      wpPostType: libraryItems.wpPostType,
      tags: libraryItems.tags,
      outcome: libraryItems.outcome,
      winnerLabel: libraryItems.winnerLabel,
      liftPct: libraryItems.liftPct,
      pBest: libraryItems.pBest,
      sessions: libraryItems.sessions,
      sourceDomain: libraryItems.sourceDomain,
      decidedAt: libraryItems.decidedAt,
      reusable: sql<boolean>`(${libraryItems.changeOps} is not null or ${libraryItems.snapshots} is not null)`,
    })
    .from(libraryItems)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(libraryItems.decidedAt))
    .limit(200);
  return rows.map((r) => ({ ...r, liftPct: r.liftPct === null ? null : Number(r.liftPct), pBest: r.pBest === null ? null : Number(r.pBest) }));
}

export async function getLibraryItem(id: string): Promise<LibraryItem | null> {
  const [row] = await getDb().select().from(libraryItems).where(eq(libraryItems.id, id)).limit(1);
  return row ?? null;
}

export async function setLibraryTags(id: string, tags: string[]): Promise<ServiceResult<{ tags: string[] }>> {
  const clean = cleanTags(tags);
  const [row] = await getDb().update(libraryItems).set({ tags: clean }).where(eq(libraryItems.id, id)).returning({ id: libraryItems.id });
  return row ? ok({ tags: clean }) : fail(404, "library_item_not_found");
}

export type ApplyResult =
  | { kind: "element_test"; testId: string; editorUrl: string | null }
  | { kind: "permanent_rule"; ruleId: string }
  | { kind: "draft_post"; postId: number; editUrl: string; permalink: string };

/**
 * Reuses a library item on another site (docs/PLAN.md section 10). Nothing here changes what visitors see
 * unless mode is "permanent":
 *  - element item, mode "test" (the default, recommended because audiences differ): a DRAFT element test on the
 *    target page with the change pre-loaded, plus an editor link to confirm or re-map its selectors.
 *  - element item, mode "permanent": the change goes live at once as a permanent rule (winners only).
 *  - page item: the winning content is pushed as a DRAFT post; the owner reviews it and can then test it.
 */
export async function applyLibraryItem(
  itemId: string,
  input: { targetSiteId: string; wpPostId?: number; mode?: "test" | "permanent" },
): Promise<ServiceResult<ApplyResult>> {
  const item = await getLibraryItem(itemId);
  if (!item) return fail(404, "library_item_not_found");
  const db = getDb();
  const [site] = await db.select().from(sites).where(eq(sites.id, input.targetSiteId)).limit(1);
  if (!site) return fail(404, "site_not_found");

  if (item.type === "element") {
    const ops = changeOpsSchema.catch([]).parse(item.changeOps ?? []);
    if (ops.length === 0) return fail(409, "library_item_has_no_changes");
    if (!input.wpPostId) return fail(400, "wp_post_id_required");
    const mode = input.mode ?? "test";

    if (mode === "permanent") {
      if (item.outcome !== "applied_variant") return fail(409, "only_winning_changes_can_be_made_permanent");
      const ruleId = `lib-${item.id}-${randomUUID().slice(0, 8)}`;
      await pushPermanentRule(site, { ruleId, postId: input.wpPostId, ops: ops.filter((o) => o.op !== "goal") });
      return ok({ kind: "permanent_rule", ruleId });
    }

    const created = await createElementTest({ siteId: site.id, wpPostId: input.wpPostId, name: `${item.name} (from library)`, trafficSplit: 50, minSampleSize: 200, minRunDays: 7, confidenceThreshold: 0.95 });
    if (!created.ok) return created;
    const b = created.data.variants.find((v) => !v.isControl);
    if (!b) return fail(500, "variant_missing");
    await db.update(variants).set({ changeOps: ops }).where(eq(variants.id, b.id));
    const link = await createEditorLink(created.data.test.id, b.key);
    return ok({ kind: "element_test", testId: created.data.test.id, editorUrl: link.ok ? link.data.url : null });
  }

  const snaps = (item.snapshots ?? {}) as Record<string, VariantSnapshot>;
  const snap = snaps[item.winnerKey] ?? Object.values(snaps).find((s) => !s.isControl) ?? Object.values(snaps)[0];
  if (!snap) return fail(409, "library_item_has_no_snapshot");
  const draft = await createLibraryDraft(site, { title: snap.title, content: snap.content, excerpt: snap.excerpt, type: item.wpPostType, libraryItemId: item.id });
  return ok({ kind: "draft_post", ...draft });
}

/** The view of an item for people and Claude: everything except the raw page bodies, which can be huge. */
export function describeLibraryItem(item: LibraryItem) {
  const snaps = (item.snapshots ?? {}) as Record<string, VariantSnapshot>;
  const { snapshots: _s, finalStats: _f, ...rest } = item;
  return {
    ...rest,
    liftPct: item.liftPct === null ? null : Number(item.liftPct),
    pBest: item.pBest === null ? null : Number(item.pBest),
    pages: Object.entries(snaps).map(([key, s]) => ({ key, label: s.label, isControl: s.isControl, title: s.title, excerpt: s.excerpt, contentChars: s.content.length })),
    finalStats: item.finalStats,
  };
}
