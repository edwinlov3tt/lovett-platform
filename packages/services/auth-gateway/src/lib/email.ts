/**
 * @package @lovett/auth-gateway
 * @file src/lib/email.ts
 *
 * Resend wrapper. Minimal — the goal is a one-shot transactional email,
 * no templating engine, no batching. When the platform's Email
 * microservice ships, swap `sendEmail` to call `env.EMAIL.sendTransactional`.
 *
 * When `RESEND_API_KEY` is unset (local dev without a Resend account),
 * `sendEmail` is a no-op that logs to console — keeps dev cheap.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const RESEND_API = "https://api.resend.com/emails";

export async function sendEmail(
  env: { RESEND_API_KEY?: string; MAGIC_LINK_FROM_ADDRESS: string },
  input: SendEmailInput,
): Promise<{ delivered: boolean; providerId?: string }> {
  if (!env.RESEND_API_KEY) {
    console.log(
      `[email:noop] would send to=${input.to} subject="${input.subject}" (set RESEND_API_KEY to enable)`,
    );
    return { delivered: false };
  }

  const body = {
    from: env.MAGIC_LINK_FROM_ADDRESS,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };

  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[email] resend ${res.status}: ${text.slice(0, 400)}`);
    return { delivered: false };
  }

  const json = (await res.json().catch(() => ({}))) as { id?: string };
  return { delivered: true, providerId: json.id };
}
