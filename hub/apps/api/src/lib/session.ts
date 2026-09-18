import type { FastifyReply, FastifyRequest } from "fastify";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/client.js";
import { sessions, users } from "@tcw/db";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./auth.js";

export type CurrentUser = { id: string; email: string };

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}

export async function createSession(reply: FastifyReply, userId: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db.insert(sessions).values({ userId, expiresAt }).returning({ id: sessions.id });
  reply.setCookie(SESSION_COOKIE_NAME, row.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    signed: true,
  });
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookie = request.cookies[SESSION_COOKIE_NAME];
  if (cookie) {
    const sessionId = request.unsignCookie(cookie).value;
    if (sessionId) {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    }
  }
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

/** Fastify preHandler: rejects with 401 unless a valid, unexpired session cookie is present. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookie = request.cookies[SESSION_COOKIE_NAME];
  if (!cookie) return reply.code(401).send({ error: "not_authenticated" });

  const unsigned = request.unsignCookie(cookie);
  if (!unsigned.valid || !unsigned.value) return reply.code(401).send({ error: "not_authenticated" });

  const [row] = await db
    .select({ id: users.id, email: users.email, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, unsigned.value), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return reply.code(401).send({ error: "session_expired" });

  request.currentUser = { id: row.id, email: row.email };
}
