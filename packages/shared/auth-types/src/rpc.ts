/**
 * @package @lovett/auth-types
 * @file src/rpc.ts
 *
 * The IdentityRPC contract — the source-of-truth method surface that
 * identity-svc implements and auth-gateway (and any future platform
 * service) calls through a `Service<IdentityService>` binding.
 *
 * This file is types-only; no runtime code. The actual class lives in
 * identity-svc and imports these types. Gateway's env shape types its
 * binding against this interface so calls are autocompleted.
 */

import type { PublicUser, User } from "./user.js";
import type { TokenPair, ValidatedSession } from "./session.js";

export interface CreateMagicLinkParams {
  email: string;
  redirectUri?: string;
  ipAddress?: string;
}

export interface CreateMagicLinkResult {
  /** Plaintext token — returned ONCE, then only the hash lives in DB. */
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface ConsumeMagicLinkParams {
  token: string;
  ipAddress?: string;
}

export interface ConsumeMagicLinkResult {
  /**
   * The `email` the magic link was issued for. The Gateway uses this to
   * call `findOrCreateUser` — user creation happens at consumption time,
   * not at issue time, so typo'd emails don't leave orphan rows.
   */
  email: string;
  redirectUri?: string;
}

export interface FindOrCreateUserParams {
  email: string;
  orgId?: string;    // defaults to 'default'
  name?: string;
}

export interface IssueSessionParams {
  userId: string;
  orgId: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Full IdentityRPC surface. Implementations must satisfy every method.
 * New methods are additive — don't remove without a migration plan
 * because all platform services may be calling the existing methods.
 */
export interface IdentityRPC {
  // User operations
  findOrCreateUser(params: FindOrCreateUserParams): Promise<User>;
  getUser(userId: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;

  // Magic link lifecycle
  createMagicLinkToken(params: CreateMagicLinkParams): Promise<CreateMagicLinkResult>;
  consumeMagicLinkToken(params: ConsumeMagicLinkParams): Promise<ConsumeMagicLinkResult | null>;

  // Session lifecycle
  issueSession(params: IssueSessionParams): Promise<TokenPair>;
  validateSession(accessToken: string): Promise<ValidatedSession | null>;
  refreshSession(refreshToken: string): Promise<TokenPair | null>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllSessionsForUser(userId: string): Promise<void>;

  // Convenience projection used by Gateway `/auth/session` + `/auth/me`.
  toPublicUser(user: User): PublicUser;
}
