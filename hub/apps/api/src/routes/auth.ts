import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "@tcw/db";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { createSession, destroySession, requireAuth } from "../lib/session.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // One-time setup: only works while zero admin users exist. Locks itself
  // out after the first successful call.
  app.post("/api/auth/bootstrap", async (request, reply) => {
    const [{ value }] = await db.select({ value: count() }).from(users);
    if (value > 0) {
      return reply.code(403).send({ error: "already_bootstrapped" });
    }
    const body = credentialsSchema.parse(request.body);
    const [user] = await db
      .insert(users)
      .values({ email: body.email.toLowerCase(), passwordHash: hashPassword(body.password) })
      .returning({ id: users.id, email: users.email });
    await createSession(reply, user.id);
    return reply.send({ user });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = credentialsSchema.parse(request.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase()))
      .limit(1);

    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    await createSession(reply, user.id);
    return reply.send({ user: { id: user.id, email: user.email } });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await destroySession(request, reply);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ user: request.currentUser });
  });
}
