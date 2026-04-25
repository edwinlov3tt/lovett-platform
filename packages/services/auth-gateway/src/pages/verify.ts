/**
 * @package @lovett/auth-gateway
 * @file src/pages/verify.ts
 *
 * GET /auth/verify — confirmation page. Renders a form whose submit
 * button POSTs the token + redirect_uri back to /auth/verify. We do
 * NOT consume the token on GET — that's the scanner-safe pattern from
 * PRD §6: email security products (Microsoft Defender, Proofpoint,
 * Mimecast, Barracuda) fetch URLs in inbound emails to scan for
 * phishing. A GET-on-mount consume would burn the single-use nonce
 * before the real user clicks, leaving them with a dead link.
 *
 * The page is pure HTML with a <form method="POST">. No JS required —
 * scanners reliably don't synthesize form submissions.
 */

import { escapeHtml } from "../lib/html-escape.js";
import { renderPage } from "./shared.js";

export interface VerifyPageInput {
  platformName: string;
  gatewayOrigin: string;
  token: string;
  redirectUri?: string;
  emailHint?: string;        // shown as "Sign in as foo@bar.com" when we know it
}

export function renderVerifyPage(input: VerifyPageInput): string {
  const body = `
    <form method="POST" action="${escapeHtml(input.gatewayOrigin)}/auth/verify">
      <input type="hidden" name="token" value="${escapeHtml(input.token)}" />
      ${input.redirectUri
        ? `<input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}" />`
        : ""}
      <button class="primary" type="submit">
        ${input.emailHint ? `Sign in as ${escapeHtml(input.emailHint)}` : "Sign in"}
      </button>
    </form>
    <p class="muted-row">
      We ask for this extra click because some email providers preview links before you click.
    </p>
  `;

  return renderPage({
    title: `Confirm sign-in · ${input.platformName}`,
    heading: "Confirm sign-in",
    subheading: `You're about to sign in to ${input.platformName}. Click below to finish.`,
    bodyHtml: body,
    platformName: input.platformName,
    footerLinks: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  });
}
