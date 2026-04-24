/**
 * @package @lovett/auth-types
 * @file src/session.ts
 *
 * Session-related shapes: JWT claims, the token-pair the Gateway hands
 * to the browser, and the validated-session payload that RPC callers
 * receive. All times are unix *seconds* to match `iat`/`exp` JWT
 * convention — don't mix seconds and milliseconds here.
 */

import { z } from "zod";

/** JWT claims minted by identity-svc and parsed back by `validateSession`. */
export const jwtClaims = z.object({
  sub: z.string(),                     // user id
  org: z.string(),                     // org id (hardcoded 'default' in MVP)
  role: z.string(),                    // 'user' | 'admin'
  sid: z.string(),                     // session id — used for DB revocation lookup
  iat: z.number().int(),
  exp: z.number().int(),
  /**
   * Unique per-token id. Populated on every mint so successive access
   * tokens for the same session (e.g. after refresh rotation) are
   * byte-distinct even when `iat`/`exp` land in the same wall-second.
   */
  jti: z.string().optional(),
});
export type JwtClaims = z.infer<typeof jwtClaims>;

/**
 * Token pair returned from `issueSession` / `refreshSession` RPCs.
 * Plaintext access + refresh tokens are only revealed once — on issue —
 * and then stored client-side as HttpOnly cookies by the Gateway.
 */
export const tokenPair = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number().int(),         // unix seconds
  refreshExpiresAt: z.number().int(),  // unix seconds
});
export type TokenPair = z.infer<typeof tokenPair>;

/**
 * Shape returned from `validateSession` — the minimum authorization
 * context a downstream service needs. More detail (full user profile)
 * comes from `getUser(userId)` when needed.
 */
export const validatedSession = z.object({
  userId: z.string(),
  orgId: z.string(),
  role: z.string(),
  sessionId: z.string(),
});
export type ValidatedSession = z.infer<typeof validatedSession>;
