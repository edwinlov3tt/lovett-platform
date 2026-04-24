/**
 * @package @lovett/auth-gateway
 * @file src/middleware/logging.ts
 *
 * Structured per-request log. Emits a single JSON line at response time.
 * Cloudflare Logpush picks these up; later the Usage service can
 * subscribe to the same stream.
 */

import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

export function loggingMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const durationMs = Date.now() - started;
    const log = {
      type: "request",
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs,
      requestId: c.get("requestId"),
      origin: c.req.header("origin") ?? null,
      ua: c.req.header("user-agent") ?? null,
      ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null,
    };
    console.log(JSON.stringify(log));
  };
}
