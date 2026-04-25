/**
 * @package @lovett/auth-gateway
 * @file src/lib/html-escape.ts
 *
 * String escaping used by every Gateway HTML surface (auth pages and
 * the magic-link email body). Lives outside the email module because
 * the /login, /auth/verify, and /auth/error pages need it too — keeping
 * it here means no circular imports between pages and email templates.
 */

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
