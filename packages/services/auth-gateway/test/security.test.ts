/**
 * @package @lovett/auth-gateway
 * @file test/security.test.ts
 *
 * Security-property tests — cookie attributes, CSRF origin-check, CORS
 * preflight, redirect-URI rejection, and an end-to-end magic-link flow.
 *
 * These are the tests that catch the specific class of bug that's
 * embarrassing when it ships to prod: not "does the happy path work"
 * but "does the unhappy path fail in the right way".
 */

import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import {
  cookieValue,
  extractSetCookies,
  fakeIdentityFrom,
  makeEnv,
} from "./helpers.js";

// ---- end-to-end ------------------------------------------------------

describe("end-to-end magic-link flow", () => {
  it("request → GET verify → POST verify → session validates", async () => {
    const env = makeEnv();

    // 1. Request a magic link (the fake captures it internally)
    const requestRes = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "e2e@example.com",
          redirect_uri: "http://localhost:3000/post-login",
        }),
      },
      env,
    );
    expect(requestRes.status).toBe(200);

    // 2. Mint a token directly from the fake so we can drive the rest
    //    of the flow (test harness only — production path is email).
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({
      email: "e2e@example.com",
      redirectUri: "http://localhost:3000/post-login",
    });

    // 3. GET /auth/verify — must render confirmation HTML, NOT consume
    const getRes = await app.request(
      `/auth/verify?token=${mint.token}&redirect=${encodeURIComponent("http://localhost:3000/post-login")}`,
      {},
      env,
    );
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toMatch(/text\/html/);
    // Still unconsumed after GET — the key test is that the POST below
    // succeeds (it can only succeed if the token wasn't burnt by GET).
    // No internal-state peeking needed.

    // 4. POST /auth/verify — consumes, issues session, 302s
    const form = new URLSearchParams();
    form.set("token", mint.token);
    form.set("redirect_uri", "http://localhost:3000/post-login");

    const postRes = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://localhost:8787",
        },
        body: form.toString(),
      },
      env,
    );
    expect(postRes.status).toBe(302);
    expect(postRes.headers.get("location")).toBe("http://localhost:3000/post-login");

    const cookies = extractSetCookies(postRes);
    const session = cookieValue(cookies, "lovett_session");
    expect(session).toBeTruthy();

    // 5. /auth/session with the issued cookie returns the user profile
    const sessionRes = await app.request(
      "/auth/session",
      { headers: { cookie: `lovett_session=${session}` } },
      env,
    );
    expect(sessionRes.status).toBe(200);
    const body = (await sessionRes.json()) as { user: { email: string } };
    expect(body.user.email).toBe("e2e@example.com");
  });
});

// ---- cookie attributes -----------------------------------------------

describe("cookie attributes", () => {
  it("session + refresh both emit HttpOnly, SameSite=Lax, and the env COOKIE_DOMAIN", async () => {
    const env = makeEnv({ COOKIE_DOMAIN: ".example.com", ENVIRONMENT: "production" });
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "c@example.com" });

    const form = new URLSearchParams();
    form.set("token", mint.token);
    const res = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://localhost:8787",
        },
        body: form.toString(),
      },
      env,
    );
    const cookies = extractSetCookies(res).join("\n");
    expect(cookies).toMatch(/lovett_session=/);
    expect(cookies).toMatch(/lovett_refresh=/);
    expect(cookies).toMatch(/Domain=\.example\.com/);
    expect(cookies).toMatch(/HttpOnly/);
    expect(cookies).toMatch(/SameSite=Lax/);
  });

  it("session cookie Path=/ and refresh cookie Path=/auth", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "p@example.com" });
    const form = new URLSearchParams();
    form.set("token", mint.token);
    const res = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://localhost:8787",
        },
        body: form.toString(),
      },
      env,
    );
    const cookies = extractSetCookies(res);
    const sessionLine = cookies.find((c) => c.startsWith("lovett_session="))!;
    const refreshLine = cookies.find((c) => c.startsWith("lovett_refresh="))!;
    expect(sessionLine).toMatch(/Path=\/(;|$)/);
    expect(refreshLine).toMatch(/Path=\/auth(;|$)/);
  });

  it("Secure flag is ON in production envs and OFF for localhost dev", async () => {
    const prodEnv = makeEnv({
      COOKIE_DOMAIN: ".example.com",
      ENVIRONMENT: "production",
    });
    const devEnv = makeEnv();                    // defaults: localhost, development

    for (const env of [prodEnv, devEnv]) {
      const fake = fakeIdentityFrom(env);
      const mint = await fake.createMagicLinkToken({ email: "s@example.com" });
      const form = new URLSearchParams();
      form.set("token", mint.token);
      const res = await app.request(
        "/auth/verify",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "http://localhost:8787",
          },
          body: form.toString(),
        },
        env,
      );
      const cookies = extractSetCookies(res).join("\n");
      if (env === prodEnv) {
        expect(cookies).toMatch(/Secure/);
      } else {
        expect(cookies).not.toMatch(/Secure/);
      }
    }
  });
});

// ---- redirect allowlist ---------------------------------------------

describe("redirect allowlist", () => {
  it("accepts a redirect whose host is exactly on the allowlist", async () => {
    const env = makeEnv({ ALLOWED_REDIRECT_HOSTS: "example.com" });
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ok@example.com",
          redirect_uri: "https://example.com/landing",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects a redirect whose host is a sibling domain of an allowlisted host", async () => {
    const env = makeEnv({ ALLOWED_REDIRECT_HOSTS: "example.com" });
    // evil-example.com doesn't match — endsWith check must be on a dot boundary
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ok@example.com",
          redirect_uri: "https://evil-example.com/steal",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("redirect_not_allowed");
  });

  it("rejects non-https redirect_uri in non-local environments", async () => {
    const env = makeEnv({
      ALLOWED_REDIRECT_HOSTS: "example.com",
      ENVIRONMENT: "production",
    });
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ok@example.com",
          redirect_uri: "http://example.com/plain-http",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ---- CSRF: POST /auth/verify Origin check ----------------------------

describe("POST /auth/verify Origin check", () => {
  it("rejects POSTs where the Origin header doesn't match GATEWAY_ORIGIN", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "csrf@example.com" });

    const form = new URLSearchParams();
    form.set("token", mint.token);

    const res = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example.net",
        },
        body: form.toString(),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Invalid sign-in origin/);
  });

  it("allows POSTs without an Origin header (same-origin form case)", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "noorig@example.com" });

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
    expect(res.status).toBe(302);
  });
});

// ---- CORS preflight --------------------------------------------------

describe("CORS preflight", () => {
  it("responds 204 to OPTIONS with ACAO echoed + ACAC:true for an allowlisted origin", async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: "https://tools.example.com" });
    const res = await app.request(
      "/auth/session",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://tools.example.com",
          "access-control-request-method": "GET",
        },
      },
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://tools.example.com");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toBe("origin");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
  });

  it("does not emit CORS headers for an origin that isn't on the allowlist", async () => {
    const env = makeEnv({ ALLOWED_ORIGINS: "https://tools.example.com" });
    const res = await app.request(
      "/auth/session",
      { method: "OPTIONS", headers: { origin: "https://attacker.example" } },
      env,
    );
    // CORS preflights that don't match still return 204 (the app let the
    // OPTIONS through); but the headers that would let the browser trust
    // the cross-origin response are absent.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
