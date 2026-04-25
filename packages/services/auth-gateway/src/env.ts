/**
 * @package @lovett/auth-gateway
 * @file src/env.ts
 *
 * Env-binding shape the runtime injects into every Hono handler.
 * Typing the IDENTITY binding against the concrete IdentityService
 * class (imported as a *type* — no runtime dependency) gives
 * `env.IDENTITY.validateSession(...)` full autocomplete + return types.
 */

import type { IdentityService } from "@lovett/identity-svc";
import type { EmailSender } from "./lib/email/sender.js";

export interface Env {
  IDENTITY: Service<IdentityService>;

  /** HS256 signing key shared with identity-svc. */
  JWT_SECRET: string;

  /**
   * Emailit API key for outbound magic-link emails (secret).
   * Empty string → Gateway falls back to NoopEmailSender (dev-only;
   * staging/prod must have this set). See ADR 0004.
   */
  EMAILIT_API_KEY: string;

  /**
   * Override the Emailit API base URL. Optional — defaults to
   * https://api.emailit.com/v2 when unset. Exists so tests + a future
   * CI canary can point at a local mock without touching prod traffic.
   */
  EMAILIT_API_BASE_URL?: string;

  /** e.g. "noreply@edwinlovett.app". Must be on a verified Emailit domain. */
  MAGIC_LINK_FROM_ADDRESS: string;

  /**
   * Parent domain cookies are scoped to. `.edwinlovett.com` in prod,
   * `localhost` during local dev. No hardcoded defaults anywhere —
   * every Set-Cookie reads this var.
   */
  COOKIE_DOMAIN: string;

  /** CORS allowlist, comma-separated. Matched case-insensitively. */
  ALLOWED_ORIGINS: string;

  /**
   * Comma-separated list of *host suffixes* that redirect_uri values
   * may end with. E.g. "edwinlovett.com,staging.edwinlovett.com".
   * Protects against open redirect into attacker domains.
   */
  ALLOWED_REDIRECT_HOSTS: string;

  /** UI copy ("Sign in to {PLATFORM_NAME}"). */
  PLATFORM_NAME: string;

  /** This Worker's own origin — used to build magic-link URLs in email. */
  GATEWAY_ORIGIN: string;

  /** Set by wrangler. `development` in dev, `staging`/`production` when deployed. */
  ENVIRONMENT?: string;

  /**
   * Test-only override. When set, buildEmailSender() returns this
   * instance instead of constructing a live Emailit adapter. Never
   * populated by the Cloudflare runtime — test helpers write it into
   * the env passed to `app.request(url, init, env)`.
   */
  _testEmailSender?: EmailSender;
}

export type Variables = {
  requestId: string;
};
