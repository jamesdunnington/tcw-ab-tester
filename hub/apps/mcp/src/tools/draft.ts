import { z } from "zod";
import { eq } from "drizzle-orm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { changeOpsSchema, createElementTestSchema, createPageTestSchema } from "@tcw/shared";
import { tests } from "@tcw/db";
import { addPageVariant, applyLibraryItem, createEditorLink, createElementTest, createPageTest, saveVariantOps } from "@tcw/core";
import { getDb } from "@tcw/core";
import { env } from "../env.js";
import { audit, contextOf, fromService, problem, requireScope, text } from "./common.js";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export function registerDraftTools(server: McpServer): void {
  server.registerTool(
    "create_element_test",
    {
      title: "Create an element test (draft)",
      description:
        "Creates a DRAFT test on one post or page where the challenger changes elements (text, colours, visibility, links) and the control is the untouched original. Nothing goes live. Next: inspect_page to find selectors, then set_variant_ops.",
      inputSchema: createElementTestSchema.shape,
      annotations: WRITE,
    },
    async (input, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:draft");
      if (denied) return denied;
      try {
        const result = await createElementTest(createElementTestSchema.parse(input));
        if (result.ok) await audit(ctx, "mcp.test_created", result.data.test.id, { type: "element" });
        return fromService(result, (d) => ({ testId: d.test.id, name: d.test.name, status: d.test.status, variants: d.variants.map((v) => ({ key: v.key, label: v.label })), next: "Use set_variant_ops on variant b." }));
      } catch (err) {
        return problem("Could not create the test. Is the site connected and the post id right?", err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "create_page_test",
    {
      title: "Create a page test (draft)",
      description:
        "Creates a DRAFT test that compares a whole post or page against a WordPress copy of it. The copy is a private draft the user edits in WordPress. Nothing goes live and no visitors see the copy until the test starts.",
      inputSchema: { ...createPageTestSchema.shape, variantLabel: z.string().min(1).max(160).default("Challenger") },
      annotations: WRITE,
    },
    async ({ variantLabel, ...rest }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:draft");
      if (denied) return denied;
      try {
        const created = await createPageTest(createPageTestSchema.parse(rest));
        if (!created.ok) return fromService(created);
        const copy = await addPageVariant(created.data.test.id, variantLabel);
        await audit(ctx, "mcp.test_created", created.data.test.id, { type: "page" });
        return fromService(copy, (d) => ({
          testId: created.data.test.id,
          name: created.data.test.name,
          status: "draft",
          copy: { key: d.variant.key, wpPostId: d.variant.wpPostId, previewUrl: d.variant.previewUrl },
          next: "The user edits the copy in WordPress (wp-admin, post id above), then starts the test.",
        }));
      } catch (err) {
        return problem("Could not create the test. Is the site connected and the post id right?", err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "set_variant_ops",
    {
      title: "Set a variant's changes",
      description:
        "Replaces ALL change operations of the challenger in a DRAFT element test. Operations: text, html, style (css properties), attr, hide, goal. Add at least one goal (the element whose clicks count as conversions). Selectors must match exactly one element: take them from inspect_page. Validation errors are returned so you can fix and retry. Refused once a test is running.",
      inputSchema: { testId: z.string().uuid(), variantKey: z.string().min(1).max(32).default("b"), ops: changeOpsSchema },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ testId, variantKey, ops }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:draft");
      if (denied) return denied;
      const [test] = await getDb().select().from(tests).where(eq(tests.id, testId)).limit(1);
      if (!test) return problem("test_not_found (404)");
      // Saving to a running test would change what live visitors see, so it needs the explicit go-live path.
      if (test.status !== "draft" && test.status !== "qa") return problem(`test_is_not_a_draft (409): this test is ${test.status}. Edits to a test that has started would change what visitors see. Stop it first, or create a new test.`);
      const saved = await saveVariantOps(testId, variantKey, ops);
      if (!saved.ok) return problem(`${saved.error} (${saved.status})`);
      await audit(ctx, "mcp.variant_ops_set", testId, { variantKey, ops: ops.length });
      const goals = ops.filter((o) => o.op === "goal").length;
      return text({ saved: true, variantKey, edits: ops.length - goals, goals, warning: goals === 0 ? "No goal is set, so the test cannot measure conversions. Add a goal op on the element people should click." : undefined });
    },
  );

  server.registerTool(
    "get_editor_link",
    {
      title: "Get the visual editor link",
      description: "A signed link that opens the visual editor on the live page for a variant, so the user can look at or fine-tune the changes. It expires after 5 minutes and only works for a logged-in WordPress editor.",
      inputSchema: { testId: z.string().uuid(), variantKey: z.string().min(1).max(32).default("b") },
      annotations: { ...WRITE, idempotentHint: true },
    },
    async ({ testId, variantKey }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:draft");
      if (denied) return denied;
      const result = await createEditorLink(testId, variantKey);
      if (result.ok) await audit(ctx, "mcp.editor_link", testId, { variantKey });
      return fromService(result, (d) => ({ url: d.url, expiresInMinutes: 5, dashboard: env.HUB_PUBLIC_URL }));
    },
  );

  server.registerTool(
    "apply_library_item",
    {
      title: "Reuse a library result on a site (draft)",
      description:
        "Reuses a past result on a site. Element item: creates a DRAFT element test on the given post with the change already loaded (start it later, and open get_editor_link to confirm or fix its selectors on that page). Page item: creates a DRAFT post on the target site from the winning content. Nothing goes live and nothing is published. Audiences differ between sites, so treat the result as a hypothesis to test, not a fact.",
      inputSchema: { itemId: z.string().uuid(), targetSiteId: z.string().uuid(), wpPostId: z.number().int().positive().optional().describe("Element items: the post or page to test on.") },
      annotations: WRITE,
    },
    async ({ itemId, targetSiteId, wpPostId }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:draft");
      if (denied) return denied;
      try {
        const result = await applyLibraryItem(itemId, { targetSiteId, wpPostId, mode: "test" });
        if (result.ok) await audit(ctx, "mcp.library_applied", itemId, { targetSiteId, kind: result.data.kind });
        return fromService(result);
      } catch (err) {
        return problem("Could not reach the target site's plugin. Is it connected and up to date?", err instanceof Error ? err.message : String(err));
      }
    },
  );
}
