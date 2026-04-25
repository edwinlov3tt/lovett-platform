/**
 * @package @lovett/auth-gateway
 * @file src/pages/error.ts
 *
 * GET /auth/error — served when the magic-link flow fails (expired /
 * already-used / malformed / bad redirect). Shows a user-friendly
 * message + a "Request a new link" CTA. The CTA routes back to /login
 * with the original redirect preserved so the user lands where they
 * were trying to go.
 */

import { escapeHtml } from "../lib/html-escape.js";
import { renderPage } from "./shared.js";

export interface ErrorPageInput {
  platformName: string;
  gatewayOrigin: string;
  message: string;
  redirectUri?: string;
}

export function renderErrorPage(input: ErrorPageInput): string {
  const loginHref = input.redirectUri
    ? `${input.gatewayOrigin}/login?redirect_uri=${encodeURIComponent(input.redirectUri)}`
    : `${input.gatewayOrigin}/login`;

  const body = `
    <div class="error-banner">${escapeHtml(input.message)}</div>
    <form action="${escapeHtml(loginHref)}" method="GET">
      ${input.redirectUri
        ? `<input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}" />`
        : ""}
      <button class="primary" type="submit">Request a new link</button>
    </form>
    <p class="muted-row">Magic links expire after 15 minutes and can only be used once.</p>
  `;

  return renderPage({
    title: `Can't sign in · ${input.platformName}`,
    heading: "Can't sign you in",
    subheading: undefined,
    bodyHtml: body,
    platformName: input.platformName,
  });
}
