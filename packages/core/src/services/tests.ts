import { and, eq } from "drizzle-orm";
import { changeOpsSchema, signEditorToken, type CreateElementTestInput, type CreatePageTestInput } from "@tcw/shared";
import { sites, tests, variants } from "@tcw/db";
import { getDb } from "../context.js";
import { decryptSecret } from "../crypto.js";
import { buildRuntimeConfig } from "../config-builder.js";
import { fetchPostInfo, pushRuntimeConfig, requestVariantDuplicate, type SiteRow } from "../wp-client.js";
import { fail, ok, type ServiceResult } from "../result.js";

type Test = typeof tests.$inferSelect;
type Variant = typeof variants.$inferSelect;

async function siteOr404(siteId: string): Promise<SiteRow | null> {
  const [site] = await getDb().select().from(sites).where(eq(sites.id, siteId)).limit(1);
  return site ?? null;
}

async function testOr404(testId: string): Promise<Test | null> {
  const [test] = await getDb().select().from(tests).where(eq(tests.id, testId)).limit(1);
  return test ?? null;
}

/** Page/post test: the test row plus control variant "a". Variant "b" is a WordPress copy, added by addPageVariant. */
export async function createPageTest(input: CreatePageTestInput): Promise<ServiceResult<{ test: Test; variants: Variant[] }>> {
  const site = await siteOr404(input.siteId);
  if (!site) return fail(404, "site_not_found");
  const postInfo = await fetchPostInfo(site, input.wpPostId);
  const db = getDb();

  const [test] = await db
    .insert(tests)
    .values({
      siteId: site.id,
      name: input.name ?? postInfo.title,
      type: "page",
      status: "draft",
      wpPostId: postInfo.id,
      wpPostType: postInfo.type,
      wpPermalink: postInfo.permalink,
      wordCount: postInfo.wordCount,
      trafficSplit: input.trafficSplit,
      minSampleSize: input.minSampleSize,
      minRunDays: input.minRunDays,
      confidenceThreshold: String(input.confidenceThreshold),
    })
    .returning();

  const [control] = await db
    .insert(variants)
    .values({ testId: test.id, key: "a", label: "Control", isControl: true, trafficWeight: 100 - input.trafficSplit })
    .returning();
  return ok({ test, variants: [control] });
}

/** Element test: no copy is made; variant "b" carries change ops instead. */
export async function createElementTest(input: CreateElementTestInput): Promise<ServiceResult<{ test: Test; variants: Variant[] }>> {
  const site = await siteOr404(input.siteId);
  if (!site) return fail(404, "site_not_found");
  const postInfo = await fetchPostInfo(site, input.wpPostId);
  const db = getDb();

  const [test] = await db
    .insert(tests)
    .values({
      siteId: site.id,
      name: input.name ?? postInfo.title,
      type: "element",
      status: "draft",
      wpPostId: postInfo.id,
      wpPostType: postInfo.type,
      wpPermalink: postInfo.permalink,
      wordCount: postInfo.wordCount,
      trafficSplit: input.trafficSplit,
      minSampleSize: input.minSampleSize,
      minRunDays: input.minRunDays,
      confidenceThreshold: String(input.confidenceThreshold),
    })
    .returning();

  const created = await db
    .insert(variants)
    .values([
      { testId: test.id, key: "a", label: "Control", isControl: true, trafficWeight: 100 - input.trafficSplit, changeOps: [] },
      { testId: test.id, key: "b", label: "Challenger", isControl: false, trafficWeight: input.trafficSplit, changeOps: [] },
    ])
    .returning();
  return ok({ test, variants: created });
}

/** Asks WordPress to duplicate the original post into the next variant key (a page test's "b"). */
export async function addPageVariant(testId: string, label = "Challenger"): Promise<ServiceResult<{ variant: Variant }>> {
  const test = await testOr404(testId);
  if (!test) return fail(404, "test_not_found");
  if (test.type !== "page") return fail(409, "not_a_page_test");
  const site = await siteOr404(test.siteId);
  if (!site) return fail(404, "site_not_found");

  const db = getDb();
  const existing = await db.select().from(variants).where(eq(variants.testId, testId));
  const nextKey = String.fromCharCode(97 + existing.length); // a, b, c, ...

  const duplicate = await requestVariantDuplicate(site, { testId: test.id, variantKey: nextKey, sourcePostId: test.wpPostId, label });
  const [variant] = await db
    .insert(variants)
    .values({ testId: test.id, key: nextKey, label, isControl: false, trafficWeight: test.trafficSplit, wpPostId: duplicate.variantWpPostId, previewUrl: duplicate.previewUrl })
    .returning();
  return ok({ variant });
}

/** Go live: pushes the config to WordPress so the assignment script is injected on the next page load. */
export async function startTest(testId: string): Promise<ServiceResult<{ test: Test }>> {
  const test = await testOr404(testId);
  if (!test) return fail(404, "test_not_found");
  if (test.status !== "draft" && test.status !== "qa") return fail(409, "test_not_startable", { status: test.status });

  const db = getDb();
  const variantRows = await db.select().from(variants).where(eq(variants.testId, testId));
  if (variantRows.length < 2) return fail(409, "needs_at_least_two_variants");
  if (test.type === "element") {
    const hasEdit = variantRows.some((v) => !v.isControl && changeOpsSchema.catch([]).parse(v.changeOps ?? []).some((o) => o.op !== "goal"));
    if (!hasEdit) return fail(409, "variant_has_no_changes");
  }

  const site = await siteOr404(test.siteId);
  if (!site) return fail(404, "site_not_found");

  const [updated] = await db.update(tests).set({ status: "running", startedAt: new Date() }).where(eq(tests.id, testId)).returning();
  await pushRuntimeConfig(site, await buildRuntimeConfig(site.id));
  return ok({ test: updated });
}

/** Stops splitting without a decision; the test becomes "inconclusive" and can still be decided later. */
export async function stopTest(testId: string): Promise<ServiceResult<{ test: Test }>> {
  const test = await testOr404(testId);
  if (!test) return fail(404, "test_not_found");
  if (test.status !== "running") return fail(409, "test_not_running", { status: test.status });
  const site = await siteOr404(test.siteId);
  if (!site) return fail(404, "site_not_found");

  const [updated] = await getDb().update(tests).set({ status: "inconclusive", endedAt: new Date() }).where(eq(tests.id, testId)).returning();
  await pushRuntimeConfig(site, await buildRuntimeConfig(site.id));
  return ok({ test: updated });
}

/** The signed URL that opens the visual editor on the live page for one variant. */
export async function createEditorLink(testId: string, variantKey: string): Promise<ServiceResult<{ url: string }>> {
  const test = await testOr404(testId);
  if (!test) return fail(404, "test_not_found");
  if (test.type !== "element") return fail(409, "not_an_element_test");

  const db = getDb();
  const [variant] = await db.select().from(variants).where(and(eq(variants.testId, testId), eq(variants.key, variantKey))).limit(1);
  if (!variant) return fail(404, "variant_not_found");
  if (variant.isControl) return fail(409, "control_is_not_editable");
  const site = await siteOr404(test.siteId);
  if (!site) return fail(404, "site_not_found");

  const token = signEditorToken({ siteKey: site.siteKey, testId: test.id, variantKey: variant.key, secret: decryptSecret(site.secretEncrypted) });
  const url = new URL(test.wpPermalink);
  url.searchParams.set("tcwab_editor", token);
  return ok({ url: url.toString() });
}

/**
 * The signed URL that opens the read-only heatmap overlay on the live page for one variant. Page tests
 * open the variant's own post (its DOM is what visitors saw); element tests always open the original page.
 */
export async function createHeatmapLink(testId: string, variantKey = "a"): Promise<ServiceResult<{ url: string }>> {
  const test = await testOr404(testId);
  if (!test) return fail(404, "test_not_found");
  const db = getDb();
  const [variant] = await db.select().from(variants).where(and(eq(variants.testId, testId), eq(variants.key, variantKey))).limit(1);
  if (!variant) return fail(404, "variant_not_found");
  const site = await siteOr404(test.siteId);
  if (!site) return fail(404, "site_not_found");

  const token = signEditorToken({ siteKey: site.siteKey, testId: test.id, variantKey: variant.key, secret: decryptSecret(site.secretEncrypted), kind: "heatmap" });
  const target = test.type === "page" && !variant.isControl && variant.previewUrl ? variant.previewUrl : test.wpPermalink;
  const url = new URL(target);
  url.searchParams.set("tcwab_heatmap", token);
  return ok({ url: url.toString() });
}
