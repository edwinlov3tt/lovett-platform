/**
 * @package @lovett/auth-types
 * @file src/errors.ts
 *
 * Shared error code enum + response shape. Gateway serializes thrown
 * `AuthError` instances to this JSON shape. SDK consumers can switch
 * on `code` for programmatic handling.
 */

import { z } from "zod";

export const authErrorCode = z.enum([
  "validation_failed",     // 400 — bad request body/query
  "unauthorized",          // 401 — missing/invalid session
  "forbidden",             // 403 — authed but not allowed
  "not_found",             // 404
  "redirect_not_allowed",  // 400 — redirect_uri not on allowlist
  "token_expired",         // 401 — magic link/JWT/refresh expired
  "token_invalid",         // 401 — malformed/mismatched token
  "token_used",            // 401 — magic link already consumed
  "session_revoked",       // 401 — session was revoked server-side
  "refresh_reuse",         // 401 — reused refresh token (attack signal)
  "rate_limited",          // 429
  "upstream_unavailable",  // 502 — Resend down, Identity RPC failure, etc.
  "internal_error",        // 500
]);
export type AuthErrorCode = z.infer<typeof authErrorCode>;

export const authErrorBody = z.object({
  code: authErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type AuthErrorBody = z.infer<typeof authErrorBody>;

export const httpStatusForCode: Record<AuthErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  redirect_not_allowed: 400,
  token_expired: 401,
  token_invalid: 401,
  token_used: 401,
  session_revoked: 401,
  refresh_reuse: 401,
  rate_limited: 429,
  upstream_unavailable: 502,
  internal_error: 500,
};
