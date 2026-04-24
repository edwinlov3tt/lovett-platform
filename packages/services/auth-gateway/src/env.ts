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

export interface Env {
  IDENTITY: Service<IdentityService>;

  /** HS256 signing key shared with identity-svc. */
  JWT_SECRET: string;

  /** Resend API key for outbound magic-link emails. */
  RESEND_API_KEY: string;

  /** e.g. "noreply@edwinlovett.com" */
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
}

export type Variables = {
  requestId: string;
};
