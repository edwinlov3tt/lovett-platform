/**
 * @package @lovett/auth-gateway
 * @file src/middleware/request-id.ts
 *
 * Request correlation id. Honors inbound `x-request-id` (with basic
 * validation) or mints a UUID. Always echoed on the response so clients
 * can reference it in bug reports. Set on the Hono context so the
 * logging middleware picks it up.
 */

import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

const REQUEST_ID_RE = /^[A-Za-z0-9_\-.]{8,128}$/;

export function requestIdMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const inbound = c.req.header("x-request-id");
    const id = inbound && REQUEST_ID_RE.test(inbound) ? inbound : crypto.randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  };
}
