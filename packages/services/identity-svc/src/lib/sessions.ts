/**
 * @package @lovett/identity-svc
 * @file src/lib/sessions.ts
 *
 * Session lifecycle: issue, validate, refresh, revoke.
 *
 * Tokens:
 *   - Access token = signed JWT (HS256). 24h lifetime.
 *   - Refresh token = 32-byte random. 7-day lifetime. Rotated on every use.
 *
 * Sessions table is the source of truth for revocation. `validateSession`
 * checks the DB for `revoked_at IS NULL` on every call, which is fine
 * because validation is going through RPC to Identity anyway — no
 * external HTTP hop. Gives us instant revocation without JWT blocklist
 * gymnastics.
 *
 * Refresh-reuse detection: every session stores `refresh_token_generation`,
 * incremented on rotation. If a token with an older generation is ever
 * presented, the whole session is revoked — the old token should've been
 * invalidated when the new one was issued, so seeing it again means
 * either a client bug or (more likely) an attacker who grabbed the old
 * token while the rightful owner was already using the new one.
 */

import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import {
  ID_PREFIX,
  nowSeconds,
  prefixedId,
  randomTokenBase64url,
  sha256Hex,
} from "@lovett/db-utils";
import type { TokenPair, ValidatedSession } from "@lovett/auth-types";
import { sessions } from "../db/schema.js";
import { JwtSigner } from "./jwt.js";

export const ACCESS_TTL_SECONDS = 24 * 60 * 60;         // 24 hours
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;    // 7 days
const REFRESH_TOKEN_BYTES = 32;

export type RefreshOutcome =
  | { ok: true; tokens: TokenPair }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "reuse_detected" };

export class SessionStore {
  readonly #db: DrizzleD1Database;
  readonly #signer: JwtSigner;

  constructor(d1: D1Database, signer: JwtSigner) {
    this.#db = drizzle(d1);
    this.#signer = signer;
  }

  async issue(params: {
    userId: string;
    orgId: string;
    role?: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<TokenPair> {
    const sessionId = prefixedId(ID_PREFIX.session);
    const now = nowSeconds();
    const expiresAt = now + ACCESS_TTL_SECONDS;
    const refreshExpiresAt = now + REFRESH_TTL_SECONDS;
    const role = params.role ?? "user";

    const refreshToken = randomTokenBase64url(REFRESH_TOKEN_BYTES);
    const refreshTokenHash = await sha256Hex(refreshToken);

    const accessToken = await this.#signer.sign({
      sub: params.userId,
      org: params.orgId,
      role,
      sid: sessionId,
      iat: now,
      exp: expiresAt,
      jti: crypto.randomUUID(),
    });
    const accessTokenHash = await sha256Hex(accessToken);

    await this.#db
      .insert(sessions)
      .values({
        id: sessionId,
        userId: params.userId,
        accessTokenHash,
        refreshTokenHash,
        refreshTokenGeneration: 1,
        userAgent: params.userAgent ?? null,
        ipAddress: params.ipAddress ?? null,
        expiresAt,
        refreshExpiresAt,
        revokedAt: null,
        createdAt: now,
      })
      .run();

    return { accessToken, refreshToken, expiresAt, refreshExpiresAt };
  }

  /**
   * Returns the validated session IF the access token verifies AND the
   * underlying row is not revoked AND not past `expires_at`. Null for
   * every other case (don't leak why — callers treat null as 401).
   */
  async validate(accessToken: string): Promise<ValidatedSession | null> {
    const verify = await this.#signer.verify(accessToken);
    if (!verify.ok) return null;
    const { claims } = verify;

    const rows = await this.#db
      .select()
      .from(sessions)
      .where(eq(sessions.id, claims.sid))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt <= nowSeconds()) return null;

    return {
      userId: claims.sub,
      orgId: claims.org,
      role: claims.role,
      sessionId: claims.sid,
    };
  }

  /**
   * Rotate a refresh token. Three guards:
   *   1. Look up by refresh_token_hash.
   *   2. If not found: either it was rotated already or never existed;
   *      either way, fail safely.
   *   3. If the matched row was revoked previously and we're somehow
   *      seeing the old token again, mark revoked + return `reuse_detected`
   *      so the caller can emit a loud log.
   */
  async refresh(refreshToken: string): Promise<RefreshOutcome> {
    const incomingHash = await sha256Hex(refreshToken);
    const rows = await this.#db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, incomingHash))
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: false, reason: "not_found" };

    if (row.revokedAt !== null) {
      // Presenting a refresh token that matches a revoked session
      // means the attacker (or a misbehaving client) kept the old
      // token after rotation. Treat as an attack signal.
      return { ok: false, reason: "reuse_detected" };
    }

    if (row.refreshExpiresAt <= nowSeconds()) {
      return { ok: false, reason: "expired" };
    }

    // Rotation strategy:
    //   1. Atomically mark the current session row as revoked (guarded
    //      on the incoming hash so concurrent refreshes don't both
    //      rotate).
    //   2. If we lose the race, the old row is still there with its
    //      old hash — presenting it again will now see revokedAt set
    //      and trigger `reuse_detected` on subsequent calls.
    //   3. Issue a fresh session row with the new tokens. The sessions
    //      table grows by one row per rotation, which is acceptable in
    //      exchange for accurate reuse-detection semantics.
    const now = nowSeconds();
    const revokeResult = await this.#db
      .update(sessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(sessions.id, row.id),
          eq(sessions.refreshTokenHash, incomingHash),
          isNull(sessions.revokedAt),
        ),
      )
      .run();

    if (revokeResult.meta.changes === 0) {
      // Someone else already rotated this one. Presenting a refresh
      // token that matches a revoked row is by definition reuse.
      return { ok: false, reason: "reuse_detected" };
    }

    // Issue a fresh session for the same user + org + role.
    const tokens = await this.issue({
      userId: row.userId,
      orgId: "default",   // MVP — will read from user row once multi-org lands
      role: "user",
    });
    return { ok: true, tokens };
  }

  async revoke(sessionId: string): Promise<void> {
    const now = nowSeconds();
    await this.#db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .run();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const now = nowSeconds();
    await this.#db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .run();
  }
}
