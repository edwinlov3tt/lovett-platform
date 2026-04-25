/**
 * @package @lovett/auth-gateway
 * @file src/lib/email/emailit.ts
 *
 * Emailit transactional email adapter. Implements EmailSender.
 *
 * API contract (as of April 2026, verified against
 * https://emailit.com/docs/api-reference/emails/send/):
 *   POST {baseUrl}/emails
 *   Headers: Authorization: Bearer <key>, Content-Type: application/json
 *   Body (snake_case): { from, to, subject, html, text }
 *   Success 200/201: { id: "em_xxx", status: "pending" | ..., ... }
 *   Error 4xx/5xx:    { error, details?, message?, validation_errors? }
 *
 * This adapter only implements the subset we need for magic-link sends.
 * Attachments, templates, CC/BCC, scheduling, tracking, and idempotency
 * keys are out of scope — if future flows need them, extend the
 * EmailSender interface, don't bolt them onto this adapter directly.
 */

import { EmailSendError, type EmailSender, type SendMagicLinkParams } from "./sender.js";
import {
  renderMagicLinkHtml,
  renderMagicLinkText,
} from "./templates/magic-link.js";

interface EmailitSendRequest {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailitSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fromAddress: string,
    private readonly platformName: string,
  ) {}

  async sendMagicLink(params: SendMagicLinkParams): Promise<void> {
    const subject = `Sign in to ${this.platformName}`;
    const html = renderMagicLinkHtml({
      platformName: this.platformName,
      verificationUrl: params.verificationUrl,
      recipientEmail: params.to,
      expiresInMinutes: params.expiresInMinutes,
    });
    const text = renderMagicLinkText({
      platformName: this.platformName,
      verificationUrl: params.verificationUrl,
      expiresInMinutes: params.expiresInMinutes,
    });

    const body: EmailitSendRequest = {
      from: this.fromAddress,
      to: params.to,
      subject,
      html,
      text,
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new EmailSendError(
        `Emailit send failed: network error (${err instanceof Error ? err.message : String(err)})`,
        "emailit",
      );
    }

    if (!res.ok) {
      const upstreamBody = await res.text().catch(() => "");
      throw new EmailSendError(
        `Emailit send failed: ${res.status}`,
        "emailit",
        res.status,
        upstreamBody,
      );
    }
  }
}
