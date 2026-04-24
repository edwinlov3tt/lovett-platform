/**
 * @package @lovett/auth-gateway
 * @file src/routes/logout.ts
 *
 * POST /auth/logout
 *
 * Validates the session cookie, calls `revokeSession`, clears cookies.
 * Idempotent — calling logout when not signed in still returns 200.
 */

import { Hono } from "hono";
import type { LogoutResponse } from "@lovett/auth-types";
import type { Env, Variables } from "../env.js";
import {
  SESSION_COOKIE,
  clearRefreshCookieHeader,
  clearSessionCookieHeader,
  isSecureCookie,
  parseCookies,
} from "../lib/cookies.js";

export const logoutRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

logoutRoutes.post("/", async (c) => {
  const cookies = parseCookies(c.req.header("cookie"));
  const accessToken = cookies[SESSION_COOKIE];

  if (accessToken) {
    const validated = await c.env.IDENTITY.validateSession(accessToken);
    if (validated) {
      await c.env.IDENTITY.revokeSession(validated.sessionId);
    }
  }

  const secure = isSecureCookie(c.env);
  c.header("set-cookie", clearSessionCookieHeader({ domain: c.env.COOKIE_DOMAIN, secure }), {
    append: true,
  });
  c.header("set-cookie", clearRefreshCookieHeader({ domain: c.env.COOKIE_DOMAIN, secure }), {
    append: true,
  });

  const body: LogoutResponse = { ok: true };
  return c.json(body);
});
