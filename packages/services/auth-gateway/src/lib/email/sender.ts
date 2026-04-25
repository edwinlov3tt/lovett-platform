/**
 * @package @lovett/auth-gateway
 * @file src/lib/email/sender.ts
 *
 * Provider-agnostic transactional email interface. Every route handler
 * that sends email imports THIS, not a concrete provider. The seam lets
 * us swap adapters (Resend → Emailit → future platform `email-svc`
 * Worker binding) without touching route code. See ADR 0004.
 */

export interface SendMagicLinkParams {
  /** Recipient address. Always a single user for magic-link sends. */
  to: string;
  /** Fully-qualified GET URL the user clicks to reach the confirmation page. */
  verificationUrl: string;
  /** Lifetime of the underlying magic-link token. Surfaces in email copy. */
  expiresInMinutes: number;
}

export interface EmailSender {
  sendMagicLink(params: SendMagicLinkParams): Promise<void>;
}

/**
 * Thrown by an EmailSender implementation when the upstream provider
 * returns a non-success status or the request fails transport-layer.
 * Never thrown for "key not configured" — that's a silent no-op so
 * local dev without a provider key keeps working.
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamBody?: string,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}
