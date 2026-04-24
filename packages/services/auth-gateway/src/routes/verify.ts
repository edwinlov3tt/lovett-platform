/**
 * @package @lovett/auth-gateway
 * @file src/routes/verify.ts
 *
 * GET /auth/verify  — renders confirmation page (does NOT consume)
 * POST /auth/verify — consumes token, issues session, sets cookies, 302s
 *
 * The split is the scanner-safe pattern from PRD §6. Security scanners
 * in corporate email gateways fetch URLs in inbound mail to check for
 * phishing; if GET consumed the token, the scanner would burn the
 * single-use nonce seconds after delivery.
 */

import { Hono, type Context } from "hono";
import { verifyTokenRequest } from "@lovett/auth-types";
import type { Env, Variables } from "../env.js";
import {
  isSecureCookie,
  setRefreshCookieHeader,
  setSessionCookieHeader,
} from "../lib/cookies.js";
import { validateRedirectUri } from "../lib/redirect-validator.js";
import { renderErrorPage } from "../pages/error.js";
import { renderVerifyPage } from "../pages/verify.js";
import { ACCESS_TTL, REFRESH_TTL } from "../constants.js";

export const verifyRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type VerifyCtx = Context<{ Bindings: Env; Variables: Variables }>;

// ---- GET /auth/verify ---------------------------------------------------

verifyRoutes.get("/", async (c) => {
  const token = c.req.query("token") ?? "";
  const redirect = c.req.query("redirect") ?? undefined;

  if (!token) {
    return renderError(c, "This sign-in link is missing its token.", redirect);
  }
  if (redirect) {
    const check = validateRedirectUri(redirect, c.env.ALLOWED_REDIRECT_HOSTS);
    if (!check.ok) return renderError(c, check.reason, undefined);
  }

  const html = renderVerifyPage({
    platformName: c.env.PLATFORM_NAME,
    gatewayOrigin: c.env.GATEWAY_ORIGIN,
    token,
    redirectUri: redirect,
  });
  return c.html(html);
});

// ---- POST /auth/verify --------------------------------------------------

verifyRoutes.post("/", async (c) => {
  // CSRF hardening: consume only when the POST originates from the
  // Gateway itself. A malicious site can't set Origin on a cross-site
  // form POST to something it doesn't control, so checking
  // `Origin === GATEWAY_ORIGIN` blocks the classic "attacker auto-
  // submits a form to /auth/verify" attack without needing explicit
  // CSRF tokens. We accept missing Origin for same-origin form POSTs
  // from our own `/auth/verify` page (Safari historically strips it
  // on same-origin submits) but reject any value that's set and
  // doesn't match.
  const origin = c.req.header("origin");
  if (origin && !originMatches(origin, c.env.GATEWAY_ORIGIN)) {
    return renderError(c, "Invalid sign-in origin.", undefined);
  }

  const contentType = c.req.header("content-type") ?? "";
  let raw: unknown;
  if (contentType.includes("application/json")) {
    raw = await c.req.json().catch(() => null);
  } else {
    // The confirmation page posts as form-urlencoded from a plain HTML form.
    raw = await c.req.parseBody().catch(() => null);
  }

  const parsed = verifyTokenRequest.safeParse(raw);
  if (!parsed.success) {
    return renderError(c, "This sign-in link is invalid.", undefined);
  }
  const { token, redirect_uri } = parsed.data;

  const redirectCheck = validateRedirectUri(redirect_uri, c.env.ALLOWED_REDIRECT_HOSTS);
  if (!redirectCheck.ok) {
    return renderError(c, redirectCheck.reason, undefined);
  }

  const consumed = await c.env.IDENTITY.consumeMagicLinkToken({
    token,
    ipAddress: c.req.header("cf-connecting-ip") ?? undefined,
  });

  if (!consumed) {
    return renderError(
      c,
      "This sign-in link is invalid, expired, or already used. Request a new one.",
      redirect_uri,
    );
  }

  // User creation happens on consumption so typos never leave orphan rows.
  const user = await c.env.IDENTITY.findOrCreateUser({
    email: consumed.email,
    orgId: "default",
  });

  const tokens = await c.env.IDENTITY.issueSession({
    userId: user.id,
    orgId: user.orgId,
    userAgent: c.req.header("user-agent") ?? undefined,
    ipAddress: c.req.header("cf-connecting-ip") ?? undefined,
  });

  const secure = isSecureCookie(c.env);
  c.header(
    "set-cookie",
    setSessionCookieHeader(tokens.accessToken, {
      domain: c.env.COOKIE_DOMAIN,
      secure,
      maxAgeSeconds: ACCESS_TTL,
    }),
    { append: true },
  );
  c.header(
    "set-cookie",
    setRefreshCookieHeader(tokens.refreshToken, {
      domain: c.env.COOKIE_DOMAIN,
      secure,
      maxAgeSeconds: REFRESH_TTL,
    }),
    { append: true },
  );

  const finalRedirect = consumed.redirectUri ?? redirect_uri ?? c.env.GATEWAY_ORIGIN;
  return c.redirect(finalRedirect, 302);
});

// ---- helpers -----------------------------------------------------------

/**
 * Normalize both sides to `{protocol}//{host}` (drop any path/query/fragment)
 * before comparing. Any value that isn't a parseable URL is rejected as
 * an invalid Origin — matches the browser's own behavior.
 */
function originMatches(incoming: string, gatewayOrigin: string): boolean {
  try {
    const a = new URL(incoming);
    const b = new URL(gatewayOrigin);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

function renderError(c: VerifyCtx, message: string, redirectUri: string | undefined) {
  return c.html(
    renderErrorPage({
      platformName: c.env.PLATFORM_NAME,
      gatewayOrigin: c.env.GATEWAY_ORIGIN,
      message,
      redirectUri,
    }),
    400,
  );
}
