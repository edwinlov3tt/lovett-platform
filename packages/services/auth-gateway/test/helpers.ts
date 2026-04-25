/**
 * @package @lovett/auth-gateway
 * @file test/helpers.ts
 *
 * Gateway test harness. Builds a fresh Env with a FakeIdentity per test,
 * plus small helpers for walking the magic-link flow from "request code"
 * through "session cookie set".
 */

import type { Env } from "../src/env.js";
import { FakeIdentity } from "./fake-identity.js";

export const TEST_JWT_SECRET = "x".repeat(48);

export function makeEnv(overrides: Partial<Env> = {}): Env {
  const identity = new FakeIdentity();
  return {
    IDENTITY: identity as unknown as Env["IDENTITY"],
    JWT_SECRET: TEST_JWT_SECRET,
    EMAILIT_API_KEY: "",                                  // no-op email send in tests
    EMAILIT_API_BASE_URL: "https://api.emailit.test/v2",  // never actually called
    MAGIC_LINK_FROM_ADDRESS: "noreply@test.invalid",
    COOKIE_DOMAIN: "localhost",
    ALLOWED_ORIGINS: "http://localhost:3000",
    ALLOWED_REDIRECT_HOSTS: "localhost,example.com,edwinlovett.com",
    PLATFORM_NAME: "Lovett Platform (test)",
    GATEWAY_ORIGIN: "http://localhost:8787",
    ENVIRONMENT: "development",
    ...overrides,
  };
}

/** Read the most recent magic-link token the fake issued during a test. */
export function fakeIdentityFrom(env: Env): FakeIdentity {
  return env.IDENTITY as unknown as FakeIdentity;
}

export function extractSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

export function cookieValue(setCookies: string[], name: string): string | null {
  for (const c of setCookies) {
    const match = c.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return match[1] ?? null;
  }
  return null;
}
