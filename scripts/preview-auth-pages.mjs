#!/usr/bin/env node
/**
 * @file scripts/preview-auth-pages.mjs
 *
 * Dev-only helper that renders auth-gateway's three HTML pages
 * (/login, /auth/verify confirmation, /auth/error) to .previews/ at
 * the repo root so you can eyeball them in a browser without running
 * `wrangler dev`. The source-of-truth renderers live in
 * packages/services/auth-gateway/src/pages/ — this script just calls
 * them with plausible dev values.
 *
 * Invoked via `pnpm preview:auth`. The rendered HTML files are
 * gitignored (.previews/*) since they're regenerable output, not source.
 *
 * Requires tsx (installed as a workspace devDep) to resolve the .ts
 * imports at runtime.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const gatewayPages = path.join(repoRoot, "packages/services/auth-gateway/src/pages");

const { renderLoginPage } = await import(
  pathToFileURL(path.join(gatewayPages, "login.ts")).href
);
const { renderVerifyPage } = await import(
  pathToFileURL(path.join(gatewayPages, "verify.ts")).href
);
const { renderErrorPage } = await import(
  pathToFileURL(path.join(gatewayPages, "error.ts")).href
);

const outDir = path.join(repoRoot, ".previews");
mkdirSync(outDir, { recursive: true });

const common = {
  platformName: "Lovett Platform",
  gatewayOrigin: "https://auth.edwinlovett.com",
};

const files = {
  "login.html": renderLoginPage({
    ...common,
    redirectUri: "https://tools.edwinlovett.com/home",
  }),
  "verify.html": renderVerifyPage({
    ...common,
    token: "example-token-43-chars-base64url-placeholder",
    redirectUri: "https://tools.edwinlovett.com/home",
    emailHint: "edwin@edwinlovett.com",
  }),
  "error.html": renderErrorPage({
    ...common,
    message:
      "This sign-in link is invalid, expired, or already used. Request a new one.",
    redirectUri: "https://tools.edwinlovett.com/home",
  }),
};

const written = [];
for (const [name, html] of Object.entries(files)) {
  const p = path.join(outDir, name);
  writeFileSync(p, html);
  written.push(p);
}

for (const p of written) console.log(p);

// Auto-open in Chrome on macOS unless --no-open is passed.
if (!process.argv.includes("--no-open") && os.platform() === "darwin") {
  try {
    execSync(`open -a "Google Chrome" ${written.map((p) => `"${p}"`).join(" ")}`, {
      stdio: "ignore",
    });
  } catch {
    // No Chrome installed or `open` unavailable — leave the caller to
    // open the files manually.
  }
}
