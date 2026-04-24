/**
 * @package @lovett/auth-gateway
 * @file src/constants.ts
 *
 * Numeric constants shared between routes. These MUST match the
 * corresponding values in identity-svc — they're duplicated here only
 * because cookie Max-Age has to be set on the Set-Cookie header at the
 * Gateway layer. Source of truth is identity-svc/src/lib/sessions.ts.
 */

export const ACCESS_TTL = 24 * 60 * 60;          // 24 hours, matches Identity
export const REFRESH_TTL = 7 * 24 * 60 * 60;     // 7 days, matches Identity
