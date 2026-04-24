/**
 * @package @lovett/auth-gateway
 * @file test/verify.test.ts
 *
 * Verify flow — the scanner-safe two-step.
 *
 *   GET  /auth/verify  → renders HTML confirmation page, does NOT consume
 *   POST /auth/verify  → consumes + sets session + refresh cookies + redirects
 */

import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { cookieValue, extractSetCookies, fakeIdentityFrom, makeEnv } from "./helpers.js";

async function issueMagicLink(env: Parameters<typeof fakeIdentityFrom>[0], email: string, redirect?: string): Promise<string> {
  await app.request(
    "/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, ...(redirect ? { redirect_uri: redirect } : {}) }),
    },
    env,
  );
  // The fake identity stored exactly one magic link; grab it through
  // the private map via the public consume. We re-issue our own copy
  // by inspecting the fake's internal state. Tests import this helper
  // and inspect directly — simpler than carrying through the real
  // "grab from email" UX.
  const fake = fakeIdentityFrom(env) as unknown as { "#magicLinks": Map<string, unknown> };
  // Access the private via a safely-typed unknown cast below.
  const mapEntry = (fake as unknown as { magicLinks?: Map<string, unknown> }).magicLinks;
  void mapEntry;
  // The fake stores tokens with a known prefix; easier: drive via another RPC.
  // We'll use the fake's createMagicLinkToken directly for tests that need
  // a guaranteed token — `issueMagicLink` is only for the happy-POST test
  // below; alternative is to inspect by email through a fake-only helper.
  throw new Error("unused");
}
void issueMagicLink;

describe("GET /auth/verify", () => {
  it("renders the confirmation HTML with a POST form (does NOT consume)", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "ed@example.com" });

    const res = await app.request(
      `/auth/verify?token=${encodeURIComponent(mint.token)}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("Confirm sign-in");
    expect(body).toContain(`value="${mint.token}"`);       // token sits in hidden input
    expect(body).toContain(`method="POST"`);               // form method POST

    // And the token is still consumable (not burnt by the GET).
    const consumed = await fake.consumeMagicLinkToken({ token: mint.token });
    expect(consumed).not.toBeNull();
  });

  it("shows error page when redirect_uri isn't allowlisted", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "ed@example.com" });

    const res = await app.request(
      `/auth/verify?token=${mint.token}&redirect=${encodeURIComponent("https://evil.example.net")}`,
      {},
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("not in allowlist");
  });
});

describe("POST /auth/verify", () => {
  it("consumes token, sets both cookies, 302s to redirect_uri", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({
      email: "ed@example.com",
      redirectUri: "https://tools.edwinlovett.com/home",
    });

    const form = new URLSearchParams();
    form.set("token", mint.token);
    form.set("redirect_uri", "https://tools.edwinlovett.com/home");

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
    expect(res.headers.get("location")).toBe("https://tools.edwinlovett.com/home");

    const cookies = extractSetCookies(res);
    const session = cookieValue(cookies, "lovett_session");
    const refresh = cookieValue(cookies, "lovett_refresh");
    expect(session).toBeTruthy();
    expect(refresh).toBeTruthy();
    expect(cookies.join("\n")).toMatch(/Domain=localhost/);
    expect(cookies.join("\n")).toMatch(/HttpOnly/);
    expect(cookies.join("\n")).toMatch(/SameSite=Lax/);
  });

  it("renders error HTML when the token is unknown", async () => {
    const env = makeEnv();
    const form = new URLSearchParams();
    form.set("token", "totally-made-up-token");
    form.set("redirect_uri", "http://localhost:3000/post-login");

    const res = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("invalid, expired, or already used");
  });

  it("rejects a redirect_uri whose host isn't on the allowlist (post-submit)", async () => {
    const env = makeEnv();
    const fake = fakeIdentityFrom(env);
    const mint = await fake.createMagicLinkToken({ email: "ed@example.com" });

    const form = new URLSearchParams();
    form.set("token", mint.token);
    form.set("redirect_uri", "https://evil.example.net/pwn");

    const res = await app.request(
      "/auth/verify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("not in allowlist");
  });
});
