/**
 * @package @lovett/auth-gateway
 * @file src/lib/errors.ts
 *
 * `AuthError` + the central `sendError` helper. Every route throws these
 * instead of returning ad-hoc `c.json({error:…}, 400)` so the JSON
 * error shape is consistent across the whole Gateway.
 */

import type { Context } from "hono";
import {
  type AuthErrorBody,
  type AuthErrorCode,
  httpStatusForCode,
} from "@lovett/auth-types";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AuthErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function isAuthError(err: unknown): err is AuthError {
  return err instanceof AuthError;
}

/**
 * Serialize an AuthError into a consistent JSON response with the
 * correct HTTP status. Also stamps the x-request-id header so the
 * client can reference it when filing bug reports.
 */
export function sendError(c: Context, err: AuthError): Response {
  const status = httpStatusForCode[err.code];
  const body: AuthErrorBody = {
    code: err.code,
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
  };
  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502);
}
