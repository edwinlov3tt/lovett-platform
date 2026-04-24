/**
 * @package @lovett/auth-gateway
 * @file src/routes/session.ts
 *
 * GET /auth/session — reads the session cookie, validates via
 * Identity RPC, returns `{ user, expiresAt }` or 401.
 *
 * If the access-token cookie is missing but a refresh cookie is
 * present, we try a one-shot refresh before declaring 401. SDK
 * callers expect this behavior so they don't need to do the refresh
 * dance themselves for every page load.
 *
 * GET /auth/me is a convenience alias for the same response shape.
 */

import { Hono, type Context } from "hono";
import type { Env, Variables } from "../env.js";
import { AuthError } from "../lib/errors.js";
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  isSecureCookie,
  parseCookies,
  setRefreshCookieHeader,
  setSessionCookieHeader,
} from "../lib/cookies.js";
import type { PublicUser, SessionResponse, User } from "@lovett/auth-types";
import { ACCESS_TTL, REFRESH_TTL } from "../constants.js";

/**
 * Inline projection to avoid an RPC round-trip for a pure shape
 * transform. Workers RPC can't ship a synchronous method back as
 * sync; wrapping this call Gateway-side keeps it plain and typed.
 */
function publicOf(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    orgId: user.orgId,
    role: user.role,
  };
}

export const sessionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type SessionCtx = Context<{ Bindings: Env; Variables: Variables }>;

sessionRoutes.get("/session", async (c) => {
  return respondWithSession(c);
});

sessionRoutes.get("/me", async (c) => {
  return respondWithSession(c);
});

// ---- internals ---------------------------------------------------------

async function respondWithSession(c: SessionCtx) {
  const cookies = parseCookies(c.req.header("cookie"));
  const accessToken = cookies[SESSION_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];

  if (accessToken) {
    const validated = await c.env.IDENTITY.validateSession(accessToken);
    if (validated) {
      const user = await c.env.IDENTITY.getUser(validated.userId);
      if (!user) throw new AuthError("unauthorized", "Session references unknown user");
      const body: SessionResponse = {
        user: publicOf(user),
        expiresAt: await deriveExpiresAt(c.env, accessToken),
      };
      return c.json(body);
    }
  }

  // No valid access token — fall back to refresh once.
  if (refreshToken) {
    const rotated = await c.env.IDENTITY.refreshSession(refreshToken);
    if (rotated) {
      const secure = isSecureCookie(c.env);
      c.header(
        "set-cookie",
        setSessionCookieHeader(rotated.accessToken, {
          domain: c.env.COOKIE_DOMAIN,
          secure,
          maxAgeSeconds: ACCESS_TTL,
        }),
        { append: true },
      );
      c.header(
        "set-cookie",
        setRefreshCookieHeader(rotated.refreshToken, {
          domain: c.env.COOKIE_DOMAIN,
          secure,
          maxAgeSeconds: REFRESH_TTL,
        }),
        { append: true },
      );
      const validated = await c.env.IDENTITY.validateSession(rotated.accessToken);
      if (validated) {
        const user = await c.env.IDENTITY.getUser(validated.userId);
        if (user) {
          const body: SessionResponse = {
            user: publicOf(user),
            expiresAt: rotated.expiresAt,
          };
          return c.json(body);
        }
      }
    }
  }

  throw new AuthError("unauthorized", "Not signed in");
}

/**
 * Derive the access-token `exp` claim without calling Identity again.
 * We only decode here (we know the Gateway got a token Identity just
 * signed; Identity already validated it one line up). The SDK uses
 * this to schedule proactive refresh.
 */
async function deriveExpiresAt(env: Env, accessToken: string): Promise<number> {
  const segs = accessToken.split(".");
  if (segs.length !== 3) return Math.floor(Date.now() / 1000) + ACCESS_TTL;
  try {
    const payload = JSON.parse(atobUrl(segs[1]!)) as { exp?: number };
    if (typeof payload.exp === "number") return payload.exp;
  } catch {
    // fall through
  }
  return Math.floor(Date.now() / 1000) + ACCESS_TTL;
  // `env` intentionally unused — present so future changes that need
  // env access don't need to refactor the signature.
  void env;
}

function atobUrl(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return atob(b64);
}
