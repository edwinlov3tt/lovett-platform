/**
 * @package @lovett/auth-gateway
 * @file src/index.ts
 *
 * Hono app bootstrap. Public entry point at auth.edwinlovett.com.
 *
 * Middleware order matters:
 *   1. requestId   — stamps every request with a correlation id
 *   2. cors        — answers preflights + adds headers
 *   3. logging     — runs last so it sees final response status + headers
 *
 * Error handling is centralized in `app.onError`. Routes throw AuthError;
 * the handler serializes to the consistent JSON error shape. Unknown
 * errors become 500 internal_error with the stack hidden from the client.
 */

import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { AuthError, isAuthError, sendError } from "./lib/errors.js";
import { corsMiddleware } from "./middleware/cors.js";
import { loggingMiddleware } from "./middleware/logging.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { logoutRoutes } from "./routes/logout.js";
import { magicLinkRoutes } from "./routes/magic-link.js";
import { refreshRoutes } from "./routes/refresh.js";
import { sessionRoutes } from "./routes/session.js";
import { verifyRoutes } from "./routes/verify.js";
import { renderLoginPage } from "./pages/login.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", requestIdMiddleware());
app.use("*", corsMiddleware());
app.use("*", loggingMiddleware());

// ---- liveness ---------------------------------------------------------

app.get("/healthz", async (c) => {
  // Shallow check: the Worker itself is running. For deep-check (RPC
  // chain down to D1) see `/healthz/full`.
  return c.json({ ok: true, service: "auth-gateway" });
});

app.get("/healthz/full", async (c) => {
  try {
    const identity = await c.env.IDENTITY.healthCheck();
    return c.json({ ok: true, service: "auth-gateway", identity });
  } catch (err) {
    return c.json(
      { ok: false, service: "auth-gateway", error: String(err) },
      503,
    );
  }
});

// ---- HTML pages -------------------------------------------------------

app.get("/login", async (c) => {
  const redirect = c.req.query("redirect_uri") ?? undefined;
  const prefilled = c.req.query("email") ?? undefined;
  const html = renderLoginPage({
    platformName: c.env.PLATFORM_NAME,
    gatewayOrigin: c.env.GATEWAY_ORIGIN,
    redirectUri: redirect,
    prefilledEmail: prefilled,
  });
  return c.html(html);
});

// ---- JSON + HTML auth endpoints ---------------------------------------

app.route("/auth/magic-link", magicLinkRoutes);
app.route("/auth/verify", verifyRoutes);
app.route("/auth/refresh", refreshRoutes);
app.route("/auth/logout", logoutRoutes);
app.route("/auth", sessionRoutes); // /auth/session + /auth/me

app.notFound((c) => sendError(c, new AuthError("not_found", `No route for ${c.req.path}`)));

app.onError((err, c) => {
  if (isAuthError(err)) return sendError(c, err);
  console.error(
    JSON.stringify({
      type: "gateway.unhandled",
      requestId: c.get("requestId"),
      err: err instanceof Error ? err.stack ?? err.message : String(err),
    }),
  );
  return sendError(c, new AuthError("internal_error", "Unexpected error"));
});

export default app;

// Re-export Env for consumers that want to type-check wrangler bindings.
export type { Env } from "./env.js";
