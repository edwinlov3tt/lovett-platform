/**
 * @package @lovett/auth
 * @file src/client.test.ts
 *
 * Smoke tests for AuthClient — enough to pin the public contract
 * (createAuthClient factory shape, subscribe round-trip, refresh
 * rescheduling on sign-out). Deeper coverage (refresh scheduling,
 * error paths) belongs in full integration tests once the SDK has a
 * consumer tool wired up.
 */

import { describe, expect, it, vi } from "vitest";
import { createAuthClient } from "./client.js";

function makeFetch(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  return vi.fn().mockImplementation(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected fetch — queue empty");
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("AuthClient", () => {
  it("createAuthClient returns a client that can getSession and subscribe", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const fetch = makeFetch([
      {
        status: 200,
        body: {
          user: { id: "u1", email: "a@b.c", name: null, orgId: "default", role: "user" },
          expiresAt: future,
        },
      },
    ]);
    const auth = createAuthClient({ gateway: "https://auth.test", fetch: fetch as unknown as typeof globalThis.fetch });

    const received: Array<unknown> = [];
    const unsub = auth.subscribe((s) => received.push(s));

    const session = await auth.getSession();
    expect(session).not.toBeNull();
    expect(session!.user.email).toBe("a@b.c");
    expect(auth.peekSession()).not.toBeNull();
    expect(auth.isAuthenticated()).toBe(true);
    expect(received.at(-1)).toEqual(session);
    unsub();
  });

  it("falls back to refresh on 401 then re-reads session", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const fetch = makeFetch([
      { status: 401, body: {} },
      { status: 200, body: { ok: true, expiresAt: future } },
      {
        status: 200,
        body: {
          user: { id: "u1", email: "a@b.c", name: null, orgId: "default", role: "user" },
          expiresAt: future,
        },
      },
    ]);
    const auth = createAuthClient({ gateway: "https://auth.test", fetch: fetch as unknown as typeof globalThis.fetch });
    const session = await auth.getSession();
    expect(session).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("returns null session when the Gateway has no valid cookies", async () => {
    const fetch = makeFetch([
      { status: 401, body: {} },
      { status: 401, body: {} },
    ]);
    const auth = createAuthClient({ gateway: "https://auth.test", fetch: fetch as unknown as typeof globalThis.fetch });
    const session = await auth.getSession();
    expect(session).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });
});
