/**
 * @package @lovett/auth-gateway
 * @file src/routes/refresh.ts
 *
 * POST /auth/refresh
 *
 * Reads the refresh cookie, asks Identity to rotate, sets new cookies.
 * On failure (expired / revoked / reused), returns 401 and the SDK
 * treats the user as signed out.
 */

import { Hono } from "hono";
import type { RefreshResponse } from "@lovett/auth-types";
import type { Env, Variables } from "../env.js";
import { AuthError } from "../lib/errors.js";
import {
  REFRESH_COOKIE,
  clearRefreshCookieHeader,
  clearSessionCookieHeader,
  isSecureCookie,
  parseCookies,
  setRefreshCookieHeader,
  setSessionCookieHeader,
} from "../lib/cookies.js";
import { ACCESS_TTL, REFRESH_TTL } from "../constants.js";

export const refreshRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

refreshRoutes.post("/", async (c) => {
  const cookies = parseCookies(c.req.header("cookie"));
  const refreshToken = cookies[REFRESH_COOKIE];
  const secure = isSecureCookie(c.env);

  if (!refreshToken) {
    throw new AuthError("unauthorized", "No refresh token");
  }

  const rotated = await c.env.IDENTITY.refreshSession(refreshToken);
  if (!rotated) {
    // Nuke both cookies so the SDK stops trying.
    c.header("set-cookie", clearSessionCookieHeader({ domain: c.env.COOKIE_DOMAIN, secure }), {
      append: true,
    });
    c.header("set-cookie", clearRefreshCookieHeader({ domain: c.env.COOKIE_DOMAIN, secure }), {
      append: true,
    });
    throw new AuthError("unauthorized", "Refresh failed");
  }

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

  const body: RefreshResponse = { ok: true, expiresAt: rotated.expiresAt };
  return c.json(body);
});
