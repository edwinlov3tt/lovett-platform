/**
 * @package @lovett/auth-gateway
 * @file src/lib/email/templates/magic-link.ts
 *
 * Light-mode HTML + plaintext body for the magic-link send. Mirrors the
 * aesthetic of the Gateway's /login and /auth/verify HTML pages so the
 * email feels continuous with the in-browser flow:
 *
 *   - white background with a recessed card
 *   - #DC2626 primary button, #CF0E0F on hover (hover unused in email)
 *   - #0A0A0A body text, #52525B muted, Inter-ish system stack
 *   - inline CSS only (mail clients strip <style>)
 *   - no external images, no tracking pixels, no open-tracking iframes
 *
 * Both functions are pure — they take params, return strings. Easy to
 * snapshot-test.
 */

import { escapeAttr, escapeHtml } from "../../html-escape.js";

export interface MagicLinkHtmlInput {
  platformName: string;
  verificationUrl: string;
  recipientEmail: string;
  expiresInMinutes: number;
}

export interface MagicLinkTextInput {
  platformName: string;
  verificationUrl: string;
  expiresInMinutes: number;
}

export function renderMagicLinkHtml(input: MagicLinkHtmlInput): string {
  const safeUrl = escapeAttr(input.verificationUrl);
  const safeUrlText = escapeHtml(input.verificationUrl);
  const safeEmail = escapeHtml(input.recipientEmail);
  const safePlatform = escapeHtml(input.platformName);
  const ttlMinutes = Math.max(1, Math.floor(input.expiresInMinutes));

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; background: #f5f5f5; padding: 32px 16px; color: #0a0a0a;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 14px; padding: 32px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
        <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.02em; color: #52525b; text-transform: uppercase; margin-bottom: 8px;">
          ${safePlatform}
        </div>
        <h1 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; letter-spacing: -0.01em;">
          Sign in to your account
        </h1>
        <p style="color: #52525b; line-height: 1.55; margin: 0 0 24px;">
          Click the button below to sign in as <strong style="color: #0a0a0a;">${safeEmail}</strong>.
          The link expires in ${ttlMinutes} minutes and can only be used once.
        </p>
        <p style="margin: 0 0 24px;">
          <a href="${safeUrl}" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 10px; font-weight: 600; text-decoration: none; font-size: 15px;">
            Sign in to ${safePlatform}
          </a>
        </p>
        <div style="color: #52525b; font-size: 12.5px; line-height: 1.55; border-top: 1px solid #e5e5e5; padding-top: 20px;">
          Or paste this URL into your browser:<br />
          <span style="word-break: break-all; color: #0a0a0a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;">${safeUrlText}</span>
        </div>
        <div style="color: #a1a1aa; font-size: 12px; margin-top: 20px;">
          If you didn't request this, you can safely ignore this email.
        </div>
      </div>
    </div>
  `.trim();
}

export function renderMagicLinkText(input: MagicLinkTextInput): string {
  const ttlMinutes = Math.max(1, Math.floor(input.expiresInMinutes));
  return [
    `Sign in to ${input.platformName}`,
    ``,
    `Use this link to sign in:`,
    input.verificationUrl,
    ``,
    `The link expires in ${ttlMinutes} minutes and can only be used once.`,
    `If you didn't request this, you can safely ignore this email.`,
  ].join("\n");
}
