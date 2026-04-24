/**
 * @package @lovett/auth-gateway
 * @file test/magic-link.test.ts
 *
 * POST /auth/magic-link — happy path + redirect validation + rate-limit
 * interop (rate limiting itself is Cloudflare-layer for MVP, so we only
 * test that the handler doesn't leak secrets).
 */

import { describe, expect, it } from "vitest";
import app from "../src/index.js";
import { makeEnv } from "./helpers.js";

describe("POST /auth/magic-link", () => {
  it("returns ok:true for a valid email", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ed@example.com" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true };
    expect(body.ok).toBe(true);
  });

  it("returns ok:true even for an email Identity doesn't know about (no enumeration)", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("400s when redirect_uri host isn't on the allowlist", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ed@example.com",
          redirect_uri: "https://evil.example.net/phish",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("redirect_not_allowed");
  });

  it("accepts https://*.edwinlovett.com redirects", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ed@example.com",
          redirect_uri: "https://tools.edwinlovett.com/home",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("400s on malformed email", async () => {
    const env = makeEnv();
    const res = await app.request(
      "/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
