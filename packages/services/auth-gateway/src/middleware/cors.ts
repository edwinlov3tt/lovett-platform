/**
 * @package @lovett/auth-gateway
 * @file src/middleware/cors.ts
 *
 * CORS with credentials enabled. Origins come from env.ALLOWED_ORIGINS
 * (comma-separated, case-insensitive). Wildcard syntax is supported:
 * `*.edwinlovett.com` matches any subdomain. Credentials=true means
 * `Access-Control-Allow-Origin` must echo a *specific* origin, never
 * `*` — the allowlist match does that.
 */

import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin) {
      const allowed = matchOrigin(origin, c.env.ALLOWED_ORIGINS);
      if (allowed) {
        c.header("access-control-allow-origin", origin);
        c.header("access-control-allow-credentials", "true");
        c.header("vary", "origin");
        c.header("access-control-allow-methods", "GET, POST, OPTIONS");
        c.header("access-control-allow-headers", "content-type, authorization");
        c.header("access-control-max-age", "600");
      }
    }

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
    return;
  };
}

function matchOrigin(origin: string, allowlistRaw: string): boolean {
  const lower = origin.toLowerCase();
  const entries = allowlistRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  for (const entry of entries) {
    if (entry === "*") return true;
    if (entry === lower) return true;
    // Wildcard subdomain: `https://*.edwinlovett.com` matches any host
    // ending in `.edwinlovett.com` on https.
    if (entry.includes("*")) {
      const pattern = entry
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\\\*/g, ".*");
      if (new RegExp(`^${pattern}$`).test(lower)) return true;
    }
  }
  return false;
}
