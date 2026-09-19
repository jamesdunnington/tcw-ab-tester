import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decisionInputSchema } from "@tcw/shared";
import { applyDecision, startTest, stopTest } from "@tcw/core";
import { actorFor, audit, contextOf, fromService, requireScope } from "./common.js";

/**
 * Anything that changes what visitors see. Each needs the separate hub:live grant AND confirm: true.
 * The server cannot tell whether the person really agreed, so the tool descriptions tell Claude to
 * ask first, Claude Desktop shows an approval prompt per call, and every call is audit-logged.
 */
const CONFIRM = z.literal(true).describe("Must be true. Only set it after the user has clearly said yes in this conversation to exactly this action.");

export function registerLiveTools(server: McpServer): void {
  server.registerTool(
    "start_test",
    {
      title: "Start a test (goes live)",
      description: "Starts a draft test: visitors are split between the variants immediately. ASK THE USER FIRST and only call after they clearly agree.",
      inputSchema: { testId: z.string().uuid(), confirm: CONFIRM },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ testId }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:live");
      if (denied) return denied;
      const result = await startTest(testId);
      if (result.ok) await audit(ctx, "mcp.test_started", testId);
      return fromService(result, (d) => ({ testId: d.test.id, status: d.test.status, startedAt: d.test.startedAt }));
    },
  );

  server.registerTool(
    "stop_test",
    {
      title: "Stop a test",
      description: "Stops splitting visitors without choosing a winner. The test becomes inconclusive and can still be decided later. ASK THE USER FIRST.",
      inputSchema: { testId: z.string().uuid(), confirm: CONFIRM },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ testId }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:live");
      if (denied) return denied;
      const result = await stopTest(testId);
      if (result.ok) await audit(ctx, "mcp.test_stopped", testId);
      return fromService(result, (d) => ({ testId: d.test.id, status: d.test.status, endedAt: d.test.endedAt }));
    },
  );

  server.registerTool(
    "apply_winner",
    {
      title: "Apply the winner (changes the live site)",
      description:
        "Ends a test that has a winner or is inconclusive. Page tests: the chosen variant's content replaces the original post (WordPress saves a revision first) and, if deleteRedundant is true, the test copy is permanently deleted. Element tests: the chosen edits become permanent for everyone. Choosing variant a keeps the original. If you choose something other than the engine's recommendation you must give a reason. THIS CANNOT BE FULLY UNDONE. Show the user the results and what will happen, and only call after they clearly say yes.",
      inputSchema: { testId: z.string().uuid(), ...decisionInputSchema.shape, confirm: CONFIRM },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ testId, chosenVariantKey, deleteRedundant, reason }, extra) => {
      const ctx = contextOf(extra.authInfo);
      const denied = requireScope(ctx, "hub:live");
      if (denied) return denied;
      const result = await applyDecision(testId, { chosenVariantKey, deleteRedundant, reason }, await actorFor(ctx));
      return fromService(result, (d) => ({ decided: true, chosenVariantKey, deleteRedundant, manifest: d.manifest }));
    },
  );
}
