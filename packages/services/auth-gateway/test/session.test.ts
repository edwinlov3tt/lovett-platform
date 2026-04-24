/**
 * @package @lovett/auth-gateway
 * @file test/session.test.ts
 *
 * /auth/session, /auth/me, /auth/refresh, /auth/logout — the authed
 * JSON surface. All use the session/refresh cookies set by /auth/verify.
 */

import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { cookieValue, extractSetCookies, fakeIdentityFrom, makeEnv } from "./helpers.js";

async function signedInCookies(env: ReturnType<typeof makeEnv>): Promise<{ access: string; refresh: string }> {
  const fake = fakeIdentityFrom(env);
  const mint = await fake.createMagicLinkToken({ email: "ed@example.com" });
  const form = new URLSearchParams();
  form.set("token", mint.token);
  const res = await app.request(
    "/auth/verify",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    env,
  );
  const cookies = extractSetCookies(res);
  const access = cookieValue(cookies, "lovett_session") ?? "";
  const refresh = cookieValue(cookies, "lovett_refresh") ?? "";
  if (!access || !refresh) throw new Error("signedInCookies: didn't receive both cookies");
  return { access, refresh };
}

describe("GET /auth/session", () => {
  it("returns { user, expiresAt } when the session cookie is valid", async () => {
    const env = makeEnv();
    const { access } = await signedInCookies(env);

    const res = await app.request(
      "/auth/session",
      { headers: { cookie: `lovett_session=${access}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string }; expiresAt: number };
    expect(body.user.email).toBe("ed@example.com");
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("401s when no cookies are present", async () => {
    const env = makeEnv();
    const res = await app.request("/auth/session", {}, env);
    expect(res.status).toBe(401);
  });

  it("refreshes with the refresh cookie when access cookie is missing", async () => {
    const env = makeEnv();
    const { refresh } = await signedInCookies(env);

    const res = await app.request(
      "/auth/session",
      { headers: { cookie: `lovett_refresh=${refresh}` } },
      env,
    );
    expect(res.status).toBe(200);
    const cookies = extractSetCookies(res);
    expect(cookies.join("\n")).toMatch(/lovett_session=/);
    expect(cookies.join("\n")).toMatch(/lovett_refresh=/);
  });
});

describe("POST /auth/refresh", () => {
  it("rotates tokens and returns ok:true", async () => {
    const env = makeEnv();
    const { refresh } = await signedInCookies(env);

    const res = await app.request(
      "/auth/refresh",
      { method: "POST", headers: { cookie: `lovett_refresh=${refresh}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; expiresAt: number };
    expect(body.ok).toBe(true);

    const cookies = extractSetCookies(res);
    const newSession = cookieValue(cookies, "lovett_session");
    const newRefresh = cookieValue(cookies, "lovett_refresh");
    expect(newSession).toBeTruthy();
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(refresh);      // rotation happened
  });

  it("401s when no refresh cookie is present", async () => {
    const env = makeEnv();
    const res = await app.request("/auth/refresh", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  it("401s + clears cookies when the refresh cookie is invalid", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/auth/refresh",
      { method: "POST", headers: { cookie: "lovett_refresh=definitely-not-a-real-token" } },
      env,
    );
    expect(res.status).toBe(401);
    const cookies = extractSetCookies(res);
    expect(cookies.join("\n")).toMatch(/Max-Age=0/);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session + clears both cookies", async () => {
    const env = makeEnv();
    const { access, refresh } = await signedInCookies(env);

    const logout = await app.request(
      "/auth/logout",
      {
        method: "POST",
        headers: { cookie: `lovett_session=${access}; lovett_refresh=${refresh}` },
      },
      env,
    );
    expect(logout.status).toBe(200);
    const cookies = extractSetCookies(logout);
    expect(cookies.join("\n")).toMatch(/Max-Age=0/);

    // Subsequent /session with the old access cookie should now 401.
    const follow = await app.request(
      "/auth/session",
      { headers: { cookie: `lovett_session=${access}` } },
      env,
    );
    expect(follow.status).toBe(401);
  });

  it("is idempotent when not signed in", async () => {
    const env = makeEnv();
    const res = await app.request("/auth/logout", { method: "POST" }, env);
    expect(res.status).toBe(200);
  });
});

describe("GET /healthz", () => {
  it("returns 200 ok shallow", async () => {
    const env = makeEnv();
    const res = await app.request("/healthz", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; service: string };
    expect(body.ok).toBe(true);
  });

  it("/healthz/full traverses Gateway → Identity RPC", async () => {
    const env = makeEnv();
    const res = await app.request("/healthz/full", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; identity: { ok: true } };
    expect(body.identity.ok).toBe(true);
  });
});
