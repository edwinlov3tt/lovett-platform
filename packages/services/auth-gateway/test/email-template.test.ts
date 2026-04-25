/**
 * @package @lovett/auth-gateway
 * @file test/email-template.test.ts
 *
 * Structural assertions on the magic-link email body. Not a pixel-diff
 * snapshot — those are brittle and every minor copy tweak becomes a
 * test update. We assert the bits that matter for deliverability and
 * security: no external assets, verification URL present + escaped,
 * no tracking pixels, light-mode token values, plaintext fallback.
 */

import { describe, expect, it } from "vitest";
import {
  renderMagicLinkHtml,
  renderMagicLinkText,
} from "../src/lib/email/templates/magic-link.js";

const PLATFORM = "Lovett Platform";
const URL = "https://auth.edwinlovett.com/auth/verify?token=abc123";
const EMAIL = "ed@example.com";

describe("renderMagicLinkHtml", () => {
  it("embeds the verification URL in an anchor href", () => {
    const html = renderMagicLinkHtml({
      platformName: PLATFORM,
      verificationUrl: URL,
      recipientEmail: EMAIL,
      expiresInMinutes: 15,
    });
    expect(html).toContain(`href="${URL}"`);
  });

  it("includes the recipient email and TTL copy", () => {
    const html = renderMagicLinkHtml({
      platformName: PLATFORM,
      verificationUrl: URL,
      recipientEmail: EMAIL,
      expiresInMinutes: 15,
    });
    expect(html).toContain(EMAIL);
    expect(html).toContain("15 minutes");
  });

  it("renders without external image URLs or tracking pixels", () => {
    const html = renderMagicLinkHtml({
      platformName: PLATFORM,
      verificationUrl: URL,
      recipientEmail: EMAIL,
      expiresInMinutes: 15,
    });
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<iframe\b/i);
    expect(html).not.toMatch(/<script\b/i);
  });

  it("uses the light-mode palette", () => {
    const html = renderMagicLinkHtml({
      platformName: PLATFORM,
      verificationUrl: URL,
      recipientEmail: EMAIL,
      expiresInMinutes: 15,
    });
    // Red primary button.
    expect(html.toLowerCase()).toContain("#dc2626");
    // Dark body text on white — no dark background.
    expect(html.toLowerCase()).toContain("#0a0a0a");
    expect(html.toLowerCase()).toContain("#ffffff");
  });

  it("escapes attacker-controlled fields (recipient email, platform name)", () => {
    const html = renderMagicLinkHtml({
      platformName: '"><script>alert(1)</script>',
      verificationUrl: URL,
      recipientEmail: '<img src=x>',
      expiresInMinutes: 15,
    });
    // Escaped — originals shouldn't appear anywhere raw.
    expect(html).not.toMatch(/<script>alert/i);
    expect(html).not.toMatch(/<img src=x>/);
    // Escaped forms are present.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("escapes the verification URL in href context", () => {
    const html = renderMagicLinkHtml({
      platformName: PLATFORM,
      verificationUrl: 'https://auth.example.com/v?token=abc"><script>',
      recipientEmail: EMAIL,
      expiresInMinutes: 15,
    });
    expect(html).not.toMatch(/"><script>/);
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});

describe("renderMagicLinkText", () => {
  it("includes the verification URL on its own line", () => {
    const text = renderMagicLinkText({
      platformName: PLATFORM,
      verificationUrl: URL,
      expiresInMinutes: 15,
    });
    const lines = text.split("\n");
    expect(lines).toContain(URL);
  });

  it("mentions the TTL and ignore-if-not-yours safety footer", () => {
    const text = renderMagicLinkText({
      platformName: PLATFORM,
      verificationUrl: URL,
      expiresInMinutes: 15,
    });
    expect(text).toContain("15 minutes");
    expect(text.toLowerCase()).toContain("ignore");
  });

  it("omits HTML tags entirely", () => {
    const text = renderMagicLinkText({
      platformName: PLATFORM,
      verificationUrl: URL,
      expiresInMinutes: 15,
    });
    expect(text).not.toMatch(/<\/?[a-z]/i);
  });
});
