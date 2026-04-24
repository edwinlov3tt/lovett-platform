/**
 * @package @lovett/identity-svc
 * @file test/magic-link.test.ts
 *
 * Happy-path + failure-mode coverage for MagicLinkStore. The important
 * invariants: single-use, expiring, hash-in-DB-not-plaintext.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MAGIC_LINK_TTL_SECONDS, MagicLinkStore } from "../src/lib/magic-link.js";
import { sha256Hex } from "@lovett/db-utils";
import { getTestEnv, resetDb } from "./setup.js";

beforeEach(resetDb);

describe("MagicLinkStore", () => {
  it("create() returns plaintext but stores only the SHA-256 hash", async () => {
    const env = getTestEnv();
    const store = new MagicLinkStore(env.DB);
    const { token, expiresAt } = await store.create({ email: "ed@example.com" });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42); // 32B base64url ~= 43 chars
    expect(expiresAt - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(MAGIC_LINK_TTL_SECONDS);

    // Plaintext token should NOT appear in the DB — only its hash should.
    const row = (await env.DB.prepare(
      "SELECT token_hash FROM magic_link_tokens WHERE email = ?",
    )
      .bind("ed@example.com")
      .first<{ token_hash: string }>())!;
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toBe(await sha256Hex(token));
  });

  it("consume() returns the original email + redirect_uri, then marks used", async () => {
    const env = getTestEnv();
    const store = new MagicLinkStore(env.DB);
    const { token } = await store.create({
      email: "ed@example.com",
      redirectUri: "https://tools.edwinlovett.com/home",
    });

    const result = await store.consume({ token });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.email).toBe("ed@example.com");
    expect(result.redirectUri).toBe("https://tools.edwinlovett.com/home");

    // A second consumption must fail (single-use guarantee).
    const second = await store.consume({ token });
    expect(second).toEqual({ ok: false, reason: "already_used" });
  });

  it("consume() fails with not_found for an unknown token", async () => {
    const store = new MagicLinkStore(getTestEnv().DB);
    const result = await store.consume({ token: "nonsense-token-value" });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("consume() fails with expired for an elapsed token", async () => {
    const env = getTestEnv();
    const store = new MagicLinkStore(env.DB);
    const { token } = await store.create({ email: "past@example.com" });

    // Fast-forward by rewinding the stored expires_at. More surgical
    // than mocking the clock globally + doesn't affect sibling tests.
    await env.DB.prepare(
      "UPDATE magic_link_tokens SET expires_at = ? WHERE email = ?",
    )
      .bind(Math.floor(Date.now() / 1000) - 1, "past@example.com")
      .run();

    const result = await store.consume({ token });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});
