import { eq } from "drizzle-orm";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { auditLog, oauthClients, users } from "@tcw/db";
import type { ServiceResult, Actor } from "@tcw/core";
import { getDb } from "@tcw/core";

export type Scope = "hub:read" | "hub:draft" | "hub:live";

export interface CallContext {
  userId: string;
  scopes: string[];
  clientId: string;
}

export function contextOf(auth: AuthInfo | undefined): CallContext {
  if (!auth) throw new Error("not_authenticated");
  return { userId: String(auth.extra?.userId ?? ""), scopes: auth.scopes, clientId: auth.clientId };
}

export const text = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
export const problem = (message: string, detail?: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: detail === undefined ? message : `${message}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}` }],
});

/** Turns a core service result into a tool result. Failures carry the error code and detail so Claude can react. */
export function fromService<T>(result: ServiceResult<T>, shape: (data: T) => unknown = (d) => d): CallToolResult {
  return result.ok ? text(shape(result.data)) : problem(`${result.error} (${result.status})`, result.detail);
}

export function requireScope(ctx: CallContext, scope: Scope): CallToolResult | null {
  return ctx.scopes.includes(scope)
    ? null
    : problem(`This connection was not granted "${scope}". Reconnect the connector in Claude and tick that permission on the approval page.`);
}

/** Audit actor for a write: names the OAuth client as well as the person, e.g. "mcp:Claude:me@example.com". */
export async function actorFor(ctx: CallContext): Promise<Actor> {
  const [user] = await getDb().select({ email: users.email }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  const [client] = await getDb().select({ metadata: oauthClients.metadata }).from(oauthClients).where(eq(oauthClients.clientId, ctx.clientId)).limit(1);
  const name = String((client?.metadata as Record<string, unknown> | undefined)?.client_name ?? ctx.clientId);
  return { userId: ctx.userId, label: `mcp:${name}:${user?.email ?? ctx.userId}` };
}

export async function audit(ctx: CallContext, action: string, target: string | null, meta: Record<string, unknown> = {}): Promise<void> {
  const actor = await actorFor(ctx);
  await getDb().insert(auditLog).values({ actor: actor.label, action, target, meta });
}
