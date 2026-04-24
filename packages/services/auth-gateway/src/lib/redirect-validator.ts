/**
 * @package @lovett/auth-gateway
 * @file src/lib/redirect-validator.ts
 *
 * Redirect URI allowlist enforcement. The `redirect_uri` parameter on
 * magic-link request + verify must point at a host in our allowlist
 * — otherwise anyone can mint magic links that bounce users to attacker
 * domains after sign-in (classic open-redirect phishing).
 *
 * Allowlist syntax (env.ALLOWED_REDIRECT_HOSTS):
 *   comma-separated list of host suffixes. "edwinlovett.com" matches any
 *   host that endsWith(".edwinlovett.com") OR equals "edwinlovett.com" exactly.
 *   "localhost" matches "localhost" (with or without port).
 *
 * Only `https://` is allowed, except localhost which also allows `http://`.
 */

export function validateRedirectUri(
  redirectUri: string | undefined,
  allowlistRaw: string,
): { ok: true; url: URL | null } | { ok: false; reason: string } {
  // Missing redirect_uri is fine — the Gateway falls back to a default
  // "you're signed in" page when the magic link has no redirect.
  if (!redirectUri) return { ok: true, url: null };

  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return { ok: false, reason: "redirect_uri is not a valid URL" };
  }

  const suffixes = allowlistRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (suffixes.length === 0) {
    return { ok: false, reason: "no redirect hosts configured" };
  }

  const host = url.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host.startsWith("127.");
  if (url.protocol !== "https:" && !isLocalhost) {
    return { ok: false, reason: "redirect_uri must be https" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "redirect_uri must be http(s)" };
  }

  for (const suffix of suffixes) {
    if (host === suffix) return { ok: true, url };
    if (host.endsWith(`.${suffix}`)) return { ok: true, url };
  }

  return { ok: false, reason: `redirect host "${host}" not in allowlist` };
}
