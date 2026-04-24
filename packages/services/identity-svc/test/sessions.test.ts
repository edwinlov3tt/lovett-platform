/**
 * @package @lovett/identity-svc
 * @file test/sessions.test.ts
 *
 * Session lifecycle: issue, validate, refresh (rotation + reuse
 * detection), revoke. This is the most security-critical surface;
 * every branch has a test.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { JwtSigner } from "../src/lib/jwt.js";
import { SessionStore } from "../src/lib/sessions.js";
import { UserRepo } from "../src/lib/users.js";
import { TEST_JWT_SECRET, getTestEnv, resetDb } from "./setup.js";

beforeEach(resetDb);

function makeStore(): { store: SessionStore; userId: Promise<string> } {
  const env = getTestEnv();
  const signer = new JwtSigner(env.JWT_SECRET);
  const store = new SessionStore(env.DB, signer);
  const userId = new UserRepo(env.DB).findOrCreate({ email: "user@example.com" }).then((u) => u.id);
  return { store, userId };
}

describe("SessionStore", () => {
  it("issue() returns a signed access token + random refresh token and persists the row", async () => {
    const { store, userId } = makeStore();
    const tokens = await store.issue({
      userId: await userId,
      orgId: "default",
    });

    expect(tokens.accessToken.split(".")).toHaveLength(3); // JWT header.payload.signature
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokens.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(tokens.refreshExpiresAt).toBeGreaterThan(tokens.expiresAt);
  });

  it("validate() succeeds for a fresh access token", async () => {
    const { store, userId } = makeStore();
    const uid = await userId;
    const tokens = await store.issue({ userId: uid, orgId: "default" });

    const validated = await store.validate(tokens.accessToken);
    expect(validated).not.toBeNull();
    expect(validated!.userId).toBe(uid);
    expect(validated!.orgId).toBe("default");
    expect(validated!.role).toBe("user");
  });

  it("validate() returns null for a token signed with the wrong secret", async () => {
    const env = getTestEnv();
    const realStore = new SessionStore(env.DB, new JwtSigner(env.JWT_SECRET));
    const { userId } = makeStore();
    const uid = await userId;
    await realStore.issue({ userId: uid, orgId: "default" });

    const fakeSigner = new JwtSigner("y".repeat(48));
    const fakeSession = new SessionStore(env.DB, fakeSigner);
    // Forge a token using the wrong secret — must not validate.
    const forgedToken = await fakeSigner.sign({
      sub: uid,
      org: "default",
      role: "user",
      sid: "sess_forged",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await fakeSession.validate(forgedToken);
    // Different signer but same DB: signature verifies with fake signer,
    // but the sid doesn't exist in the sessions table → null.
    expect(result).toBeNull();
    // Also: verifying the forged token against the real signer fails outright.
    const crossResult = await realStore.validate(forgedToken);
    expect(crossResult).toBeNull();
  });

  it("validate() returns null after the session is revoked", async () => {
    const { store, userId } = makeStore();
    const uid = await userId;
    const tokens = await store.issue({ userId: uid, orgId: "default" });
    const pre = await store.validate(tokens.accessToken);
    expect(pre).not.toBeNull();

    await store.revoke(pre!.sessionId);
    const post = await store.validate(tokens.accessToken);
    expect(post).toBeNull();
  });

  it("refresh() rotates the refresh token and invalidates the old one", async () => {
    const { store, userId } = makeStore();
    const uid = await userId;
    const first = await store.issue({ userId: uid, orgId: "default" });

    const rotated = await store.refresh(first.refreshToken);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.tokens.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.tokens.accessToken).not.toBe(first.accessToken);

    // The old refresh token is now stale — presenting it again triggers
    // the reuse detection path.
    const replay = await store.refresh(first.refreshToken);
    expect(replay).toEqual({ ok: false, reason: "reuse_detected" });
  });

  it("refresh() returns reuse_detected when the session has already been revoked", async () => {
    const { store, userId } = makeStore();
    const uid = await userId;
    const tokens = await store.issue({ userId: uid, orgId: "default" });
    const validated = await store.validate(tokens.accessToken);
    await store.revoke(validated!.sessionId);

    const result = await store.refresh(tokens.refreshToken);
    expect(result).toEqual({ ok: false, reason: "reuse_detected" });
  });

  it("refresh() returns not_found for a totally bogus refresh token", async () => {
    const { store } = makeStore();
    const result = await store.refresh("not-a-real-refresh-token");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("revokeAllForUser revokes every active session and leaves them un-validatable", async () => {
    const { store, userId } = makeStore();
    const uid = await userId;
    const a = await store.issue({ userId: uid, orgId: "default" });
    const b = await store.issue({ userId: uid, orgId: "default" });

    await store.revokeAllForUser(uid);

    expect(await store.validate(a.accessToken)).toBeNull();
    expect(await store.validate(b.accessToken)).toBeNull();
  });
});

describe("JwtSigner", () => {
  it("rejects secrets shorter than 32 chars", () => {
    expect(() => new JwtSigner("short")).toThrow(/at least 32/);
  });

  it("sign + verify roundtrip preserves claims", async () => {
    const signer = new JwtSigner(TEST_JWT_SECRET);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signer.sign({
      sub: "user_1",
      org: "default",
      role: "user",
      sid: "sess_1",
      iat,
      exp: iat + 60,
    });
    const result = await signer.verify(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.sub).toBe("user_1");
    expect(result.claims.sid).toBe("sess_1");
  });

  it("verify returns expired on an elapsed token", async () => {
    const signer = new JwtSigner(TEST_JWT_SECRET);
    const iat = Math.floor(Date.now() / 1000) - 3600;
    const token = await signer.sign({
      sub: "user_1",
      org: "default",
      role: "user",
      sid: "sess_1",
      iat,
      exp: iat + 60,
    });
    const result = await signer.verify(token);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("verify returns bad_signature when tampered", async () => {
    const signer = new JwtSigner(TEST_JWT_SECRET);
    const iat = Math.floor(Date.now() / 1000);
    const token = await signer.sign({
      sub: "user_1",
      org: "default",
      role: "user",
      sid: "sess_1",
      iat,
      exp: iat + 60,
    });
    // Swap last byte of signature segment.
    const [h, p, sig] = token.split(".");
    const tampered = `${h}.${p}.${sig!.slice(0, -1)}${sig!.slice(-1) === "A" ? "B" : "A"}`;
    const result = await signer.verify(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["bad_signature", "malformed"]).toContain(result.reason);
  });
});
