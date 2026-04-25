/**
 * @package @lovett/auth-gateway
 * @file src/pages/login.ts
 *
 * GET /login — email-entry page. POSTs to /auth/magic-link via fetch.
 * Inline JS because we don't have a bundler for the Gateway and this
 * page is ~20 lines of logic. Keeps the served HTML self-contained.
 */

import { escapeHtml } from "../lib/html-escape.js";
import { renderPage } from "./shared.js";

export interface LoginPageInput {
  platformName: string;
  gatewayOrigin: string;
  redirectUri?: string;       // pass-through to /auth/magic-link
  prefilledEmail?: string;    // e.g. bounced from /signup when email exists
  errorMessage?: string;
}

export function renderLoginPage(input: LoginPageInput): string {
  const body = `
    ${input.errorMessage ? `<div class="error-banner">${escapeHtml(input.errorMessage)}</div>` : ""}
    <form id="mlform" autocomplete="on">
      <label for="email">Email address</label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autocomplete="email"
        inputmode="email"
        autofocus
        placeholder="you@company.com"
        value="${escapeHtml(input.prefilledEmail ?? "")}" />
      <button id="submit" class="primary" type="submit">Send magic link</button>
    </form>
    <p class="muted-row">New here? A sign-in link gets sent to your email — no password.</p>
    <div id="sent" style="display:none; margin-top: 20px; padding: 14px 16px; background: #fafafa; border: 1px solid var(--hairline); border-radius: 10px; font-size: 13px; color: var(--ink-600); line-height: 1.55;">
      Check your inbox — we sent a sign-in link to <span id="sent-email" class="email-pill"></span>.
      The link expires in 15 minutes and can only be used once.
    </div>
    <script>
      (function () {
        var form = document.getElementById('mlform');
        var btn  = document.getElementById('submit');
        var sentEl = document.getElementById('sent');
        var sentEmail = document.getElementById('sent-email');
        var redirectUri = ${JSON.stringify(input.redirectUri ?? null)};
        form.addEventListener('submit', async function (e) {
          e.preventDefault();
          var email = (document.getElementById('email').value || '').trim().toLowerCase();
          if (!email) return;
          btn.disabled = true;
          btn.textContent = 'Sending…';
          try {
            var payload = { email: email };
            if (redirectUri) payload.redirect_uri = redirectUri;
            var res = await fetch('${input.gatewayOrigin}/auth/magic-link', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error('http ' + res.status);
            form.style.display = 'none';
            sentEmail.textContent = email;
            sentEl.style.display = 'block';
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Send magic link';
            alert('Couldn't send the link. Try again in a moment.');
          }
        });
      })();
    </script>
  `;

  return renderPage({
    title: `Sign in · ${input.platformName}`,
    heading: "Sign in",
    subheading: "Enter your work email. We'll send you a one-time sign-in link.",
    bodyHtml: body,
    platformName: input.platformName,
    footerLinks: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
      { label: "Status", href: "#" },
    ],
  });
}
