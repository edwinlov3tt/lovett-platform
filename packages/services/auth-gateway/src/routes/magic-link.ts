/**
 * @package @lovett/auth-gateway
 * @file src/routes/magic-link.ts
 *
 * POST /auth/magic-link
 *
 * Public endpoint. Takes an email (+ optional redirect_uri) and:
 *   1. Validates the redirect against ALLOWED_REDIRECT_HOSTS
 *   2. Calls IDENTITY.createMagicLinkToken to get a plaintext token
 *   3. Sends an email (via the injected EmailSender) containing
 *      `{gateway}/auth/verify?token=…&redirect=…`
 *   4. Returns `{ ok: true }` ALWAYS — no user enumeration
 *
 * The email is fire-and-forget via waitUntil so the response isn't
 * gated on provider latency. If the upstream is down, the user sees a
 * success response and no email; they can re-request after the window.
 *
 * This route imports the EmailSender *interface*, not any concrete
 * provider. buildEmailSender() in lib/email/factory decides which
 * adapter to instantiate at request time. See ADR 0004.
 */

import { Hono } from "hono";
import { magicLinkRequest, type MagicLinkResponse } from "@lovett/auth-types";
import type { Env, Variables } from "../env.js";
import { AuthError } from "../lib/errors.js";
import { validateRedirectUri } from "../lib/redirect-validator.js";
import { buildEmailSender } from "../lib/email/factory.js";

const MAGIC_LINK_TTL_MINUTES = 15;

export const magicLinkRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

magicLinkRoutes.post("/", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = magicLinkRequest.safeParse(raw);
  if (!parsed.success) {
    throw new AuthError("validation_failed", "Invalid magic-link request", {
      issues: parsed.error.flatten(),
    });
  }

  const { email, redirect_uri } = parsed.data;

  const redirectCheck = validateRedirectUri(redirect_uri, c.env.ALLOWED_REDIRECT_HOSTS);
  if (!redirectCheck.ok) {
    throw new AuthError("redirect_not_allowed", redirectCheck.reason);
  }

  // Always respond OK. If Identity fails, we still don't leak that —
  // the error gets logged server-side but the client sees success so an
  // attacker can't distinguish "unknown email" from "temporary outage".
  const body: MagicLinkResponse = { ok: true };

  try {
    const { token } = await c.env.IDENTITY.createMagicLinkToken({
      email,
      redirectUri: redirect_uri,
      ipAddress: c.req.header("cf-connecting-ip") ?? undefined,
    });

    const verificationUrl = buildVerifyUrl(c.env.GATEWAY_ORIGIN, token, redirect_uri);
    const sender = buildEmailSender(c.env);

    const sendPromise = sender
      .sendMagicLink({
        to: email,
        verificationUrl,
        expiresInMinutes: MAGIC_LINK_TTL_MINUTES,
      })
      .catch((err) => {
        console.error(
          JSON.stringify({
            type: "auth.magic_link.email_failed",
            requestId: c.get("requestId"),
            err: err instanceof Error ? err.message : String(err),
          }),
        );
      });
    waitUntil(c, sendPromise);

    console.log(
      JSON.stringify({ type: "auth.magic_link.requested", email, requestId: c.get("requestId") }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        type: "auth.magic_link.rpc_failed",
        requestId: c.get("requestId"),
        err: String(err),
      }),
    );
  }

  return c.json(body);
});

function buildVerifyUrl(origin: string, token: string, redirectUri: string | undefined): string {
  const url = new URL("/auth/verify", origin);
  url.searchParams.set("token", token);
  if (redirectUri) url.searchParams.set("redirect", redirectUri);
  return url.toString();
}

function waitUntil(
  c: { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } },
  p: Promise<unknown>,
): void {
  try {
    c.executionCtx?.waitUntil?.(p);
  } catch {
    p.catch(() => {});
  }
}
