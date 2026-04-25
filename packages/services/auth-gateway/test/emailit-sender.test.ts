/**
 * @package @lovett/auth-gateway
 * @file test/emailit-sender.test.ts
 *
 * Unit coverage for the Emailit adapter. We stub `fetch` at the global
 * level so nothing leaves the sandbox. Every assertion is about the
 * wire shape we promise Emailit — if one of these breaks, the upstream
 * contract changed and the adapter needs a real review (not a test
 * tweak).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailitSender } from "../src/lib/email/emailit.js";
import { EmailSendError } from "../src/lib/email/sender.js";

const API_KEY = "secret_test_key";
const BASE_URL = "https://api.emailit.test/v2";
const FROM = "noreply@edwinlovett.app";
const PLATFORM = "Lovett Platform (test)";

function buildSender(): EmailitSender {
  return new EmailitSender(API_KEY, BASE_URL, FROM, PLATFORM);
}

function okJson(): Response {
  return new Response(
    JSON.stringify({ id: "em_test123", status: "pending" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EmailitSender.sendMagicLink — happy path", () => {
  it("POSTs to {baseUrl}/emails with Bearer auth and snake_case body", async () => {
    const fetchMock = vi.fn(async () => okJson());
    vi.stubGlobal("fetch", fetchMock);

    const sender = buildSender();
    await sender.sendMagicLink({
      to: "ed@example.com",
      verificationUrl: "https://auth.example.com/auth/verify?token=abc&redirect=https%3A%2F%2Ftool.example.com",
      expiresInMinutes: 15,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe(`${BASE_URL}/emails`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
    });

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe(FROM);
    expect(body.to).toBe("ed@example.com");
    expect(body.subject).toContain(PLATFORM);
    expect(body.html).toContain("Sign in to your account");
    expect(body.html).toContain("auth.example.com/auth/verify");
    expect(body.text).toContain("https://auth.example.com/auth/verify");
    expect(body.text).toContain("15 minutes");
  });

  it("resolves without error on any 2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 201 })),
    );
    await expect(
      buildSender().sendMagicLink({
        to: "ed@example.com",
        verificationUrl: "https://auth.example.com/auth/verify?token=abc",
        expiresInMinutes: 15,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("EmailitSender.sendMagicLink — upstream failure surfaces as EmailSendError", () => {
  it("wraps 4xx with status + upstream body", async () => {
    const upstream = JSON.stringify({
      error: "Validation failed",
      validation_errors: ["Invalid to email address"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(upstream, { status: 400 })),
    );

    await expect(
      buildSender().sendMagicLink({
        to: "broken",
        verificationUrl: "https://x.test/v",
        expiresInMinutes: 15,
      }),
    ).rejects.toMatchObject({
      name: "EmailSendError",
      provider: "emailit",
      upstreamStatus: 400,
      upstreamBody: upstream,
    });
  });

  it("wraps 5xx with status + upstream body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("internal boom", { status: 502 })),
    );

    let caught: unknown;
    try {
      await buildSender().sendMagicLink({
        to: "ed@example.com",
        verificationUrl: "https://x.test/v",
        expiresInMinutes: 15,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EmailSendError);
    const err = caught as EmailSendError;
    expect(err.provider).toBe("emailit");
    expect(err.upstreamStatus).toBe(502);
    expect(err.upstreamBody).toContain("internal boom");
  });

  it("wraps 429 rate-limit responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Rate limit exceeded", retry_after: 1 }),
            { status: 429 },
          ),
      ),
    );

    await expect(
      buildSender().sendMagicLink({
        to: "ed@example.com",
        verificationUrl: "https://x.test/v",
        expiresInMinutes: 15,
      }),
    ).rejects.toMatchObject({ upstreamStatus: 429, provider: "emailit" });
  });

  it("wraps network/transport errors with no status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("NetworkError: upstream unreachable");
      }),
    );

    let caught: unknown;
    try {
      await buildSender().sendMagicLink({
        to: "ed@example.com",
        verificationUrl: "https://x.test/v",
        expiresInMinutes: 15,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EmailSendError);
    const err = caught as EmailSendError;
    expect(err.provider).toBe("emailit");
    expect(err.upstreamStatus).toBeUndefined();
    expect(err.message).toMatch(/network error/i);
  });
});
