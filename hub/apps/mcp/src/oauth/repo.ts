import { and, eq, isNull } from "drizzle-orm";
import { oauthClients, oauthCodes, oauthTokens } from "@tcw/db";
import type { Database } from "@tcw/db";

export interface ClientRecord {
  clientId: string;
  /** Plaintext here; the pg repo encrypts it at rest. */
  clientSecret: string | null;
  metadata: Record<string, unknown>;
}

export interface CodeRecord {
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string | null;
  expiresAt: Date;
}

export interface TokenRecord {
  id: string;
  tokenHash: string;
  kind: "access" | "refresh";
  familyId: string;
  clientId: string;
  userId: string;
  scopes: string[];
  resource: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/** Storage the OAuth service needs. Two implementations: Postgres (production) and in-memory (tests). */
export interface OAuthRepo {
  getClient(clientId: string): Promise<ClientRecord | undefined>;
  saveClient(client: ClientRecord): Promise<void>;
  saveCode(code: CodeRecord): Promise<void>;
  peekCode(codeHash: string): Promise<CodeRecord | undefined>;
  /** Atomically removes and returns the code, so a second call (a replay) gets nothing. */
  consumeCode(codeHash: string): Promise<CodeRecord | undefined>;
  saveToken(token: TokenRecord): Promise<void>;
  findToken(tokenHash: string): Promise<TokenRecord | undefined>;
  /** Marks a refresh token used; false if it was already used or revoked (a replay). */
  markTokenUsed(id: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeToken(tokenHash: string, at: Date): Promise<void>;
}

export function createMemoryRepo(): OAuthRepo {
  const clients = new Map<string, ClientRecord>();
  const codes = new Map<string, CodeRecord>();
  const tokens = new Map<string, TokenRecord>();
  return {
    async getClient(id) { return clients.get(id); },
    async saveClient(c) { clients.set(c.clientId, c); },
    async saveCode(c) { codes.set(c.codeHash, c); },
    async peekCode(h) { return codes.get(h); },
    async consumeCode(h) {
      const c = codes.get(h);
      codes.delete(h);
      return c;
    },
    async saveToken(t) { tokens.set(t.tokenHash, { ...t }); },
    async findToken(h) { return tokens.get(h); },
    async markTokenUsed(id, at) {
      for (const t of tokens.values()) {
        if (t.id === id) {
          if (t.usedAt || t.revokedAt) return false;
          t.usedAt = at;
          return true;
        }
      }
      return false;
    },
    async revokeFamily(familyId, at) {
      for (const t of tokens.values()) if (t.familyId === familyId && !t.revokedAt) t.revokedAt = at;
    },
    async revokeToken(h, at) {
      const t = tokens.get(h);
      if (t && !t.revokedAt) t.revokedAt = at;
    },
  };
}

export function createPgRepo(db: Database, box: { encrypt(s: string): string; decrypt(s: string): string }): OAuthRepo {
  const toToken = (r: typeof oauthTokens.$inferSelect): TokenRecord => ({
    id: r.id,
    tokenHash: r.tokenHash,
    kind: r.kind as "access" | "refresh",
    familyId: r.familyId,
    clientId: r.clientId,
    userId: r.userId,
    scopes: r.scopes as string[],
    resource: r.resource,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    revokedAt: r.revokedAt,
  });
  const toCode = (r: typeof oauthCodes.$inferSelect): CodeRecord => ({ ...r, scopes: r.scopes as string[] });

  return {
    async getClient(clientId) {
      const [r] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
      if (!r) return undefined;
      return { clientId: r.clientId, clientSecret: r.clientSecretEncrypted ? box.decrypt(r.clientSecretEncrypted) : null, metadata: r.metadata as Record<string, unknown> };
    },
    async saveClient(c) {
      await db.insert(oauthClients).values({ clientId: c.clientId, clientSecretEncrypted: c.clientSecret ? box.encrypt(c.clientSecret) : null, metadata: c.metadata });
    },
    async saveCode(c) {
      await db.insert(oauthCodes).values({ ...c });
    },
    async peekCode(codeHash) {
      const [r] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).limit(1);
      return r ? toCode(r) : undefined;
    },
    async consumeCode(codeHash) {
      const [r] = await db.delete(oauthCodes).where(eq(oauthCodes.codeHash, codeHash)).returning();
      return r ? toCode(r) : undefined;
    },
    async saveToken(t) {
      await db.insert(oauthTokens).values({ ...t });
    },
    async findToken(tokenHash) {
      const [r] = await db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, tokenHash)).limit(1);
      return r ? toToken(r) : undefined;
    },
    async markTokenUsed(id, at) {
      const rows = await db.update(oauthTokens).set({ usedAt: at }).where(and(eq(oauthTokens.id, id), isNull(oauthTokens.usedAt), isNull(oauthTokens.revokedAt))).returning({ id: oauthTokens.id });
      return rows.length === 1;
    },
    async revokeFamily(familyId, at) {
      await db.update(oauthTokens).set({ revokedAt: at }).where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
    },
    async revokeToken(tokenHash, at) {
      await db.update(oauthTokens).set({ revokedAt: at }).where(and(eq(oauthTokens.tokenHash, tokenHash), isNull(oauthTokens.revokedAt)));
    },
  };
}

