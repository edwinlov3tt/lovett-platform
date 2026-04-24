/**
 * @package @lovett/auth-gateway
 * @file src/pages/shared.ts
 *
 * Shared HTML chrome for /login, /auth/verify (confirmation), /auth/error.
 *
 * **Aesthetic** (PRD §19):
 *   - White background (#FFFFFF body), subtle #FAFAFA recess behind card
 *   - Red accent: #DC2626 primary, #CF0E0F hover
 *   - Dark text: #0A0A0A primary, #52525B muted
 *   - Inter / DM Sans
 *   - One card, generous padding, one clear primary action
 *   - Single muted legalese line
 *
 * These pages are raw HTML strings — no client framework, no build step
 * for the Gateway. That's deliberate: the auth pages are the one piece
 * that MUST work even when everything else is broken.
 */

import { escapeHtml } from "../lib/email-template.js";

export interface PageChromeInput {
  title: string;
  heading: string;
  subheading?: string;
  bodyHtml: string;         // already-escaped / trusted HTML for the card body
  platformName: string;
  footerLinks?: { label: string; href: string }[];
}

export function renderPage(input: PageChromeInput): string {
  const { title, heading, subheading, bodyHtml, platformName, footerLinks } = input;
  const footer = (footerLinks ?? []).map(
    (l) => `<a href="${escapeHtml(l.href)}" style="color: inherit; text-decoration: none;">${escapeHtml(l.label)}</a>`,
  ).join(`<span style="margin: 0 8px; color: #d4d4d8;">·</span>`);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #ffffff;
      --page-bg: #fafafa;
      --ink-900: #0a0a0a;
      --ink-600: #3f3f46;
      --ink-500: #52525b;
      --ink-400: #71717a;
      --ink-300: #a1a1aa;
      --hairline: #e4e4e7;
      --red-primary: #dc2626;
      --red-hover: #cf0e0f;
      --card-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px -8px rgba(0,0,0,0.08);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--page-bg); color: var(--ink-900);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      -webkit-font-smoothing: antialiased; }
    .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 32px 20px; }
    .brand { font-size: 12.5px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--ink-500); margin-bottom: 24px; }
    .card { width: 100%; max-width: 420px; background: var(--bg); border: 1px solid var(--hairline);
      border-radius: 14px; box-shadow: var(--card-shadow); padding: 36px 32px; }
    .card h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 8px; line-height: 1.25; }
    .card .sub { color: var(--ink-500); font-size: 14px; line-height: 1.55; margin: 0 0 24px; }
    form { display: flex; flex-direction: column; gap: 12px; }
    label { font-size: 12.5px; font-weight: 600; color: var(--ink-600); margin-bottom: 4px; display: block; }
    input[type="email"], input[type="text"] {
      width: 100%; height: 42px; padding: 0 12px; border: 1px solid var(--hairline);
      border-radius: 10px; font-family: inherit; font-size: 14.5px; background: #ffffff;
      color: var(--ink-900); outline: none; transition: border-color 120ms ease;
    }
    input[type="email"]:focus, input[type="text"]:focus { border-color: var(--red-primary); }
    button.primary { width: 100%; height: 42px; border: none; border-radius: 10px;
      background: var(--red-primary); color: #ffffff; font-weight: 600; font-size: 14.5px;
      cursor: pointer; transition: background 120ms ease; font-family: inherit; }
    button.primary:hover { background: var(--red-hover); }
    button.primary:disabled { opacity: 0.6; cursor: not-allowed; }
    .legalese { margin-top: 28px; font-size: 11.5px; color: var(--ink-400); text-align: center;
      line-height: 1.6; }
    .legalese a { color: inherit; text-decoration: underline; text-decoration-color: var(--ink-300); }
    .error-banner { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;
      padding: 10px 12px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; }
    .muted-row { color: var(--ink-500); font-size: 13px; margin: 12px 0 0; text-align: center; }
    .muted-row a { color: var(--ink-600); text-decoration: none; font-weight: 600; }
    .muted-row a:hover { color: var(--red-primary); }
    .email-pill { display: inline-block; padding: 2px 8px; border-radius: 6px;
      background: #f5f5f5; color: var(--ink-900); font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand">${escapeHtml(platformName)}</div>
    <div class="card">
      <h1>${escapeHtml(heading)}</h1>
      ${subheading ? `<p class="sub">${subheading}</p>` : ""}
      ${bodyHtml}
    </div>
    ${footer ? `<div class="legalese">${footer}</div>` : ""}
  </div>
</body>
</html>`;
}
