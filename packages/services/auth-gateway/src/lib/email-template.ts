/**
 * @package @lovett/auth-gateway
 * @file src/lib/email-template.ts
 *
 * Light-mode transactional email body for the magic-link send.
 * Inline CSS only — mail clients don't honor <style>. Kept simple so
 * it renders in every client (Outlook still in the mix for the
 * foreseeable future).
 */

export interface MagicLinkEmailInput {
  link: string;
  email: string;
  platformName: string;
}

export function magicLinkEmail(input: MagicLinkEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const safeLink = escapeAttr(input.link);
  const safeLinkText = escapeHtml(input.link);
  const safeEmail = escapeHtml(input.email);
  const safePlatform = escapeHtml(input.platformName);

  const subject = `Sign in to ${input.platformName}`;
  const text = [
    `Hi,`,
    ``,
    `Use this link to sign in to ${input.platformName}:`,
    input.link,
    ``,
    `The link expires in 15 minutes and can only be used once.`,
    `If you didn't request this, you can safely ignore this email.`,
  ].join("\n");

  const html = `
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
          The link expires in 15 minutes and can only be used once.
        </p>
        <p style="margin: 0 0 24px;">
          <a href="${safeLink}" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 12px 24px; border-radius: 10px; font-weight: 600; text-decoration: none; font-size: 15px;">
            Sign in to ${safePlatform}
          </a>
        </p>
        <div style="color: #52525b; font-size: 12.5px; line-height: 1.55; border-top: 1px solid #e5e5e5; padding-top: 20px;">
          Or paste this URL into your browser:<br />
          <span style="word-break: break-all; color: #0a0a0a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;">${safeLinkText}</span>
        </div>
        <div style="color: #a1a1aa; font-size: 12px; margin-top: 20px;">
          If you didn't request this, you can safely ignore this email.
        </div>
      </div>
    </div>
  `.trim();

  return { subject, html, text };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
