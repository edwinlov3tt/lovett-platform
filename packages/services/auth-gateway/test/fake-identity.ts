/**
 * @package @lovett/auth-gateway
 * @file test/fake-identity.ts
 *
 * In-memory IdentityService stub used by Gateway route tests. Implements
 * the RPC surface well enough to exercise the Gateway's request shaping,
 * cookie emission, and error branches without standing up the real
 * identity-svc Worker + D1 bindings.
 *
 * IMPORTANT: this is NOT a correctness model of identity-svc. If you're
 * asserting session-lifecycle invariants (rotation, reuse detection,
 * hash-not-plaintext), use the real identity-svc tests. This stub's job
 * is letting the Gateway exercise happy paths + negative branches.
 */

import type {
  CreateMagicLinkParams,
  CreateMagicLinkResult,
  FindOrCreateUserParams,
  IssueSessionParams,
  PublicUser,
  TokenPair,
  User,
  ValidatedSession,
} from "@lovett/auth-types";

export class FakeIdentity {
  #nextUserId = 1;
  #nextSessionId = 1;
  #users = new Map<string, User>();
  #emailToUserId = new Map<string, string>();
  #magicLinks = new Map<string, { email: string; redirectUri?: string; expired?: boolean; used?: boolean }>();
  #sessions = new Map<string, { userId: string; orgId: string; role: string; revoked?: boolean; refreshToken: string }>();
  #tokenToSession = new Map<string, string>();

  /** test controls — not part of RPC */
  markMagicLinkExpired(token: string): void {
    const entry = this.#magicLinks.get(token);
    if (entry) entry.expired = true;
  }

  async findOrCreateUser(params: FindOrCreateUserParams): Promise<User> {
    const lower = params.email.toLowerCase();
    const existingId = this.#emailToUserId.get(lower);
    if (existingId) return this.#users.get(existingId)!;
    const id = `user_${this.#nextUserId++}`;
    const now = Math.floor(Date.now() / 1000);
    const user: User = {
      id,
      email: lower,
      emailVerifiedAt: now,
      name: params.name ?? null,
      orgId: params.orgId ?? "default",
      role: "user",
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    this.#users.set(id, user);
    this.#emailToUserId.set(lower, id);
    return user;
  }

  async getUser(userId: string): Promise<User | null> {
    return this.#users.get(userId) ?? null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const id = this.#emailToUserId.get(email.toLowerCase());
    return id ? this.#users.get(id) ?? null : null;
  }

  async createMagicLinkToken(params: CreateMagicLinkParams): Promise<CreateMagicLinkResult> {
    const token = `magic_${crypto.randomUUID()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
    this.#magicLinks.set(token, {
      email: params.email.toLowerCase(),
      redirectUri: params.redirectUri,
    });
    return { token, expiresAt };
  }

  async consumeMagicLinkToken(params: {
    token: string;
  }): Promise<{ email: string; redirectUri?: string } | null> {
    const entry = this.#magicLinks.get(params.token);
    if (!entry) return null;
    if (entry.expired) return null;
    if (entry.used) return null;
    entry.used = true;
    return { email: entry.email, ...(entry.redirectUri ? { redirectUri: entry.redirectUri } : {}) };
  }

  async issueSession(params: IssueSessionParams): Promise<TokenPair> {
    const sessionId = `sess_${this.#nextSessionId++}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 24 * 60 * 60;
    const refreshExpiresAt = now + 7 * 24 * 60 * 60;
    const refreshToken = `refresh_${crypto.randomUUID()}`;
    // Plain JWT-shaped token string — not signed, but the Gateway
    // doesn't verify it; it hands it to validateSession below.
    const payload = btoa(JSON.stringify({ sub: params.userId, org: params.orgId, role: "user", sid: sessionId, iat: now, exp: expiresAt }));
    const accessToken = `fakehdr.${payload}.fakesig`;
    this.#sessions.set(sessionId, {
      userId: params.userId,
      orgId: params.orgId,
      role: "user",
      refreshToken,
    });
    this.#tokenToSession.set(accessToken, sessionId);
    this.#tokenToSession.set(refreshToken, sessionId);
    return { accessToken, refreshToken, expiresAt, refreshExpiresAt };
  }

  async validateSession(accessToken: string): Promise<ValidatedSession | null> {
    const sid = this.#tokenToSession.get(accessToken);
    if (!sid) return null;
    const row = this.#sessions.get(sid);
    if (!row || row.revoked) return null;
    return { userId: row.userId, orgId: row.orgId, role: row.role, sessionId: sid };
  }

  async refreshSession(refreshToken: string): Promise<TokenPair | null> {
    const sid = this.#tokenToSession.get(refreshToken);
    if (!sid) return null;
    const row = this.#sessions.get(sid);
    if (!row || row.revoked) return null;
    const pair = await this.issueSession({ userId: row.userId, orgId: row.orgId });
    row.revoked = true; // old session out, new one in
    return pair;
  }

  async revokeSession(sessionId: string): Promise<void> {
    const row = this.#sessions.get(sessionId);
    if (row) row.revoked = true;
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    for (const [, row] of this.#sessions) {
      if (row.userId === userId) row.revoked = true;
    }
  }

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      orgId: user.orgId,
      role: user.role,
    };
  }

  async healthCheck(): Promise<{ ok: true; ts: number }> {
    return { ok: true, ts: Math.floor(Date.now() / 1000) };
  }
}
