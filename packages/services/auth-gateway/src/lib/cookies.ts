/**
 * @package @lovett/auth-gateway
 * @file src/lib/cookies.ts
 *
 * Cookie helpers. Both session + refresh cookies share:
 *   - Domain = env.COOKIE_DOMAIN  (never hardcoded)
 *   - HttpOnly
 *   - Secure (except local dev on localhost)
 *   - SameSite=Lax  (NOT Strict — see PRD §10)
 *
 * Session cookie path = "/"  (sent on every request to any subdomain under COOKIE_DOMAIN)
 * Refresh cookie path = "/auth"  (only sent to Gateway — reduces attack surface)
 */

export const SESSION_COOKIE = "lovett_session";
export const REFRESH_COOKIE = "lovett_refresh";

export interface CookieOpts {
  domain: string;
  secure: boolean;
  maxAgeSeconds: number;
  path?: string;
}

export function setSessionCookieHeader(token: string, opts: CookieOpts): string {
  return buildCookie(SESSION_COOKIE, token, {
    ...opts,
    path: opts.path ?? "/",
  });
}

export function setRefreshCookieHeader(token: string, opts: CookieOpts): string {
  return buildCookie(REFRESH_COOKIE, token, {
    ...opts,
    path: opts.path ?? "/auth",
  });
}

export function clearSessionCookieHeader(opts: { domain: string; secure: boolean }): string {
  return buildCookie(SESSION_COOKIE, "", {
    domain: opts.domain,
    secure: opts.secure,
    maxAgeSeconds: 0,
    path: "/",
  });
}

export function clearRefreshCookieHeader(opts: { domain: string; secure: boolean }): string {
  return buildCookie(REFRESH_COOKIE, "", {
    domain: opts.domain,
    secure: opts.secure,
    maxAgeSeconds: 0,
    path: "/auth",
  });
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const chunk of header.split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

/**
 * Decide whether to emit the `Secure` flag. Localhost always skips it
 * (browsers reject Secure over HTTP from localhost); everything else
 * should always be Secure in real deploys.
 */
export function isSecureCookie(env: { ENVIRONMENT?: string; COOKIE_DOMAIN: string }): boolean {
  if (env.ENVIRONMENT === "development") return false;
  if (env.COOKIE_DOMAIN === "localhost" || env.COOKIE_DOMAIN.startsWith("127.")) return false;
  return true;
}

// ---- internals ----

function buildCookie(
  name: string,
  value: string,
  opts: CookieOpts & { path: string },
): string {
  const attrs = [
    `${name}=${value}`,
    `Domain=${opts.domain}`,
    `Path=${opts.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) attrs.push("Secure");
  return attrs.join("; ");
}
