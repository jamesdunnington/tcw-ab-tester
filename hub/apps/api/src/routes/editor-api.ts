import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { changeOpsSchema, renewEditorToken, verifyEditorToken, type EditorTokenKind, type EditorTokenPayload } from "@tcw/shared";
import { z } from "zod";
import { db } from "../db/client.js";
import { sites, variants } from "@tcw/db";
import { decryptSecret, getHeatData, saveVariantOps } from "@tcw/core";

/**
 * API the visual editor calls from the customer's WordPress origin. There is
 * no session cookie there, so every call carries the editor's signed bearer
 * token (see @tcw/shared editor-token). The token pins the site, test and
 * variant, so it can read and write exactly one variant and nothing else. A
 * "heatmap" token (the read-only overlay) is a different kind: it can read heat
 * data for its test and cannot touch ops, and an editor token cannot read heat data.
 */
async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: EditorTokenKind | "any" = "editor",
): Promise<{ payload: EditorTokenPayload; secret: string; siteKey: string } | null> {
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const deny = (error: string) => {
    void reply.code(401).send({ error });
    return null;
  };

  // The payload is read unverified only to find which site secret to verify with.
  let siteKey: string;
  try {
    siteKey = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")).sk;
  } catch {
    return deny("invalid_token");
  }
  if (typeof siteKey !== "string") return deny("invalid_token");

  const [site] = await db.select().from(sites).where(eq(sites.siteKey, siteKey)).limit(1);
  if (!site) return deny("invalid_token");

  const secret = decryptSecret(site.secretEncrypted);
  const result = verifyEditorToken(token, secret, siteKey, undefined, kind);
  if (!result.ok) return deny(result.reason === "expired" ? "token_expired" : "invalid_token");
  return { payload: result.payload, secret, siteKey };
}

export async function editorApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/editor/ops", async (request, reply) => {
    const auth = await authorize(request, reply);
    if (!auth) return;
    const [variant] = await db
      .select()
      .from(variants)
      .where(and(eq(variants.testId, auth.payload.t), eq(variants.key, auth.payload.v)))
      .limit(1);
    if (!variant) return reply.code(404).send({ error: "variant_not_found" });
    return reply.send({ ops: changeOpsSchema.catch([]).parse(variant.changeOps ?? []) });
  });

  app.put("/editor/ops", async (request, reply) => {
    const auth = await authorize(request, reply);
    if (!auth) return;
    const { ops } = z.object({ ops: changeOpsSchema }).parse(request.body);
    const saved = await saveVariantOps(auth.payload.t, auth.payload.v, ops);
    if (!saved.ok) return reply.code(saved.status).send({ error: saved.error });
    return reply.send({ ok: true, savedAt: new Date().toISOString() });
  });

  app.post("/editor/renew", async (request, reply) => {
    const auth = await authorize(request, reply, "any");
    if (!auth) return;
    const header = request.headers.authorization as string;
    const renewed = renewEditorToken(header.slice(7), auth.secret, auth.siteKey);
    if (!renewed.ok) return reply.code(401).send({ error: renewed.reason });
    return reply.send({ token: renewed.token, expiresAt: renewed.payload.exp });
  });

  // Heat data for the on-page overlay: the token's test, any variant, filtered by device.
  app.get("/editor/heatmap", async (request, reply) => {
    const auth = await authorize(request, reply, "heatmap");
    if (!auth) return;
    const q = z.object({ variant: z.string().min(1).max(32).optional(), device: z.enum(["desktop", "tablet", "mobile"]).optional() }).parse(request.query);
    const result = await getHeatData(auth.payload.t, { variantKey: q.variant, device: q.device });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send(result.data);
  });
}
