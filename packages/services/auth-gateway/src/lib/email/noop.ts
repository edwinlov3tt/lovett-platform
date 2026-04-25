/**
 * @package @lovett/auth-gateway
 * @file src/lib/email/noop.ts
 *
 * No-op EmailSender for local dev without a provider key. Logs a single
 * line so developers know an email WOULD have sent, including the
 * verification URL so they can click it directly during testing.
 *
 * Selected automatically by buildEmailSender() when EMAILIT_API_KEY is
 * unset or empty. Never used in staging/prod — the Worker deploy should
 * fail loudly if the secret is missing there (see wrangler.toml notes).
 */

import type { EmailSender, SendMagicLinkParams } from "./sender.js";

export class NoopEmailSender implements EmailSender {
  async sendMagicLink(params: SendMagicLinkParams): Promise<void> {
    console.log(
      `[email:noop] would send magic link to=${params.to} url=${params.verificationUrl} ttl=${params.expiresInMinutes}m (set EMAILIT_API_KEY to enable)`,
    );
  }
}
