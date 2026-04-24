/**
 * @package @lovett/auth-types
 * @file src/gateway-api.ts
 *
 * Zod schemas for the Gateway's public HTTP surface. These are both the
 * request/response contract for SDK consumers AND the server-side input
 * validators. Any change here is a breaking SDK change — bump the SDK
 * version when you touch these.
 */

import { z } from "zod";
import { publicUser } from "./user.js";

/** POST /auth/magic-link */
export const magicLinkRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  redirect_uri: z.string().url().optional(),
});
export type MagicLinkRequest = z.infer<typeof magicLinkRequest>;

export const magicLinkResponse = z.object({
  ok: z.literal(true),
});
export type MagicLinkResponse = z.infer<typeof magicLinkResponse>;

/** POST /auth/verify */
export const verifyTokenRequest = z.object({
  token: z.string().min(1).max(500),
  redirect_uri: z.string().url().optional(),
});
export type VerifyTokenRequest = z.infer<typeof verifyTokenRequest>;

/** GET /auth/session, GET /auth/me */
export const sessionResponse = z.object({
  user: publicUser,
  /** Unix seconds — access token expiry. Clients use this to schedule refresh. */
  expiresAt: z.number().int(),
});
export type SessionResponse = z.infer<typeof sessionResponse>;

/** POST /auth/refresh — no request body (reads refresh cookie) */
export const refreshResponse = z.object({
  ok: z.literal(true),
  expiresAt: z.number().int(),
});
export type RefreshResponse = z.infer<typeof refreshResponse>;

/** POST /auth/logout — no request body (reads session cookie) */
export const logoutResponse = z.object({
  ok: z.literal(true),
});
export type LogoutResponse = z.infer<typeof logoutResponse>;
