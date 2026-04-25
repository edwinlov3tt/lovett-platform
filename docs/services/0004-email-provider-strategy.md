# ADR 0004 — Email Provider Strategy

**Status:** Accepted
**Date:** 2026-04-24
**Deciders:** Edwin Lovett
**Supersedes:** Implicit Resend choice from PRD v1 Section 11 (Email Delivery)

---

## Context

The Auth Gateway MVP (see `docs/prds/auth-platform-mvp.md` Section 11) was specified to use Resend for magic-link delivery. Resend works well at the API level but has a blocking constraint for this use case: **Resend's Hobby/free tier supports only one verified sending domain per account.** The author's Resend account is already committed to another project's domain, so routing Lovett Platform auth email through the same Resend account would require a paid upgrade purely to add a second domain — which is unjustifiable for MVP volume.

Beyond unblocking MVP, this platform is explicitly designed to serve many projects over time — each potentially with its own sender domain — and will ultimately need to:

- Send from arbitrary verified domains without per-domain billing friction
- Issue per-project credentials so individual tools and Claude Code instances don't handle upstream provider keys directly
- Track usage per project/tenant
- Fail over gracefully if any single provider has an outage or imposes a rate limit
- Swap the underlying provider over time without any consumer-facing breakage

A tactical provider swap therefore has to be made consistent with the longer-term direction, so we don't bake in another single-provider dependency that needs to be ripped out in six months.

### Providers evaluated (as of April 2026)

| Provider | Free/lifetime terms | Multi-domain | Notes |
|---|---|---|---|
| **Resend** | 3,000/mo free, 1 domain on Hobby plan | ❌ on free tier | Excellent DX. Blocked by single-domain limit. |
| **Emailit** | Lifetime deal in hand: 5,000/day, 2/sec, unlimited domains | ✅ | REST + SMTP. Clean API. Includes audiences/templates/suppressions/webhooks. Becomes primary. |
| **Brevo** | 300/day (~9k/mo) permanent free, multi-domain | ✅ | Marketing-first UX but API is solid. Good fallback. |
| **AWS SES** | $0.10 per 1,000 emails, unlimited domains | ✅ | Cheapest at scale. IAM setup is the tax. Overflow tier. |
| **Cloudflare Email Service** | Beta on Workers Paid. Per-account variable daily quota. | ✅ | Architecturally ideal — binds directly to Workers like D1/KV. Beta status means APIs may change and deliverability reputation is unknown. Not for production auth today; becomes primary once GA. |
| **Twilio SendGrid** | Permanent free tier retired May 2025; 60-day trial then $19.95/mo | ✅ paid | Off the table for free usage. |
| **SiteGround SMTP** | Bundled with existing hosting | ✅ own domain | Reputation pool is for the main website, not platform auth. Explicitly kept out of the platform. |

## Decision

1. **Emailit is the primary email provider for the Lovett Platform**, used for all transactional email (magic links, notifications, future receipts).

2. **Auth Gateway MVP uses Emailit directly, abstracted behind a provider-agnostic `EmailSender` interface.** No direct coupling to Emailit's SDK in any route handler. The interface is the seam that lets us swap providers later with no route-level changes.

3. **A dedicated `email-gateway` + `email-svc` microservice pair will be built as the next platform service after Auth ships and is integrated into one consumer tool.** That service will implement multi-provider routing, per-tenant API-key issuance, quota enforcement, and unified delivery logging. Auth Gateway will migrate from calling Emailit directly to calling `env.EMAIL.sendTransactional(...)` via Workers RPC service binding at that time.

4. **Per-tenant API keys (issued by `email-gateway`) become the primary consumer credential.** Upstream provider keys (Emailit, Brevo, SES) are held exclusively by the gateway and never distributed to consumer projects or Claude Code instances.

5. **Provider fallback order, once the gateway exists:** Emailit (primary) → Brevo (secondary) → SES (overflow). Cloudflare Email Service becomes primary when it exits beta and has demonstrated deliverability parity.

## Consequences

### Positive

- Auth Gateway unblocked immediately with zero incremental cost (Emailit lifetime deal covers MVP volume many times over — 5,000/day vs. expected auth traffic in the hundreds/day at most)
- Multi-domain sending available from day one without provider upgrade
- Future migration to the platform email gateway requires changing only the `EmailSender` implementation in Auth — routes, schemas, and tests are untouched
- Eventually enables the "Claude Code never needs an upstream email token" property — each project gets a `lovett_em_live_…` key that the gateway mints and tracks
- Provider diversification (once gateway ships) means a single-provider outage doesn't take down platform auth

### Negative / trade-offs

- Emailit's 2-emails-per-second rate limit means any future high-burst use case (mass notifications, not auth) would have to queue. Not a concern for transactional auth flows at any realistic scale.
- Emailit is a smaller provider than SendGrid/Mailgun; deliverability reputation is real but less battle-tested for very-high-volume use. Acceptable for MVP; gateway's multi-provider routing mitigates this long-term.
- Adding the `email-gateway` microservice is operational complexity that doesn't exist today. This is accepted as the correct long-term shape and is deferred out of Auth MVP to keep the current scope tight.

### Neutral

- SiteGround SMTP remains in use for `edwinlovett.com` main-site email (contact forms, site-originated transactional). It is explicitly out-of-scope for the platform; keeping the reputation pools separate is intentional.

## Alternatives Considered

**Stay on Resend and upgrade to a paid plan.** Rejected: pays for a capability (multi-domain) that Emailit already provides for free via the lifetime deal, and creates future migration pain when the platform needs more than one provider anyway.

**Use Brevo directly as the MVP provider.** Viable, but Emailit's lifetime deal is strictly more generous (5,000/day vs. Brevo's 300/day). Brevo is better kept as the free fallback tier inside the gateway.

**Self-host SMTP from Cloudflare Workers.** Rejected: Workers cannot open raw SMTP connections reliably, and sending from Cloudflare egress IPs with no warm-up would destroy deliverability for auth email specifically. Magic links must hit the inbox reliably.

**Route auth email through SiteGround SMTP.** Rejected: conflates the main website's sender reputation with the platform's. Also doesn't solve the multi-domain problem cleanly and adds a non-Workers-native integration.

**Use Cloudflare Email Service now as the primary.** Rejected for the moment: still in beta, per-account daily limits are variable and unpublished, and its deliverability reputation is brand new. Not an acceptable risk surface for auth specifically. Revisit at GA — it's architecturally the cleanest fit and will likely become primary then.

## Implementation — Auth Gateway (this ADR's concrete scope)

This section is the handoff to Claude Code. Everything below replaces Section 11 of the PRD for the current implementation.

### 1. Environment variables

Replace the existing Resend env vars in `auth-gateway/wrangler.toml` and `.dev.vars.example`:

**Remove:**
- `RESEND_API_KEY`

**Add:**
- `EMAILIT_API_KEY` — secret, set via `wrangler secret put`
- `EMAILIT_API_BASE_URL` — defaults to `https://api.emailit.com/v2`, overridable for testing

Existing env vars that remain unchanged:
- `MAGIC_LINK_FROM_ADDRESS`
- `PLATFORM_NAME`
- `GATEWAY_ORIGIN`

Update `.dev.vars.example` to reflect the rename. Commit both changes in the same PR.

### 2. The `EmailSender` interface

Create `packages/services/auth-gateway/src/lib/email/sender.ts`:

```ts
export interface EmailSender {
  sendMagicLink(params: {
    to: string;
    verificationUrl: string;
    expiresInMinutes: number;
  }): Promise<void>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly upstreamStatus?: number,
    public readonly upstreamBody?: string,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}
```

Every route handler that currently sends email imports and uses `EmailSender`, not a concrete provider. The concrete implementation is constructed once at Worker init and injected into handlers (via context or a lightweight service-locator — match the pattern already used for `env.IDENTITY`). **No route handler should ever `import` from `emailit.ts` directly.** This is the seam that protects against future migration pain.

### 3. The Emailit adapter

Create `packages/services/auth-gateway/src/lib/email/emailit.ts`:

```ts
import type { EmailSender } from './sender';
import { EmailSendError } from './sender';

interface EmailitSendRequest {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface EmailitSendResponse {
  id: string;
  status: string;
}

export class EmailitSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fromAddress: string,
    private readonly platformName: string,
  ) {}

  async sendMagicLink(params: {
    to: string;
    verificationUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = `Your sign-in link for ${this.platformName}`;
    const html = renderMagicLinkHtml({
      platformName: this.platformName,
      verificationUrl: params.verificationUrl,
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

    const res = await fetch(`${this.baseUrl}/emails`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const upstreamBody = await res.text().catch(() => '');
      throw new EmailSendError(
        `Emailit send failed: ${res.status}`,
        'emailit',
        res.status,
        upstreamBody,
      );
    }
  }
}
```

**Note on the exact endpoint path and response shape:** verify against the current Emailit API docs at `https://emailit.com/docs/api-reference/emails/send/` before committing. If the path or field names differ from what's shown above, update the adapter. Do not guess. The auth flow is too load-bearing to ship with unverified upstream contracts.

### 4. Template rendering

Create `packages/services/auth-gateway/src/lib/email/templates/magic-link.ts` with two exported functions: `renderMagicLinkHtml(params)` and `renderMagicLinkText(params)`.

**Design requirements (match the light-mode login page aesthetic from PRD Section 19):**
- HTML template: white background (#FFFFFF), red primary button (#DC2626, #CF0E0F hover), dark body text (#0A0A0A), muted secondary text (#52525B), system font stack (Inter/DM Sans/system-ui)
- Single centered CTA button: "Sign in to {platformName}"
- One line stating link expires in `{expiresInMinutes}` minutes
- Plaintext fallback: plain text with the URL on its own line, short and scannable
- No tracking pixels, no open-tracking images
- All CSS inline (many email clients strip `<style>`)
- No external image references
- Clear "If you didn't request this, you can ignore this email." safety footer

Keep both functions pure — they take params and return strings. Unit-test them against a snapshot.

### 5. Worker bootstrap wiring

In `packages/services/auth-gateway/src/index.ts` (or wherever the Hono app is constructed), instantiate the sender at worker init and pass it to the route factory:

```ts
import { EmailitSender } from './lib/email/emailit';
import type { EmailSender } from './lib/email/sender';

// In the fetch handler / app builder:
const emailSender: EmailSender = new EmailitSender(
  env.EMAILIT_API_KEY,
  env.EMAILIT_API_BASE_URL ?? 'https://api.emailit.com/v2',
  env.MAGIC_LINK_FROM_ADDRESS,
  env.PLATFORM_NAME,
);
```

Pass `emailSender` into the magic-link route handler via Hono's context or as a constructor argument to the route factory. The route handler's signature references `EmailSender`, not `EmailitSender`.

### 6. Tests to add or update

Replace any existing Resend-specific tests. Required additions:

- **Unit tests for `EmailitSender`:**
  - Happy path: mocks `fetch`, asserts request URL, headers (`Authorization: Bearer ...`, `Content-Type: application/json`), and request body shape
  - Upstream 4xx: asserts `EmailSendError` is thrown with `provider: 'emailit'` and the status code
  - Upstream 5xx: same as above, different status
  - Network failure: asserts fetch rejection surfaces as `EmailSendError`

- **Template snapshot tests** for `renderMagicLinkHtml` and `renderMagicLinkText` — lock the output so visual regressions are caught in code review

- **Integration test for the magic-link route handler** using an in-memory `EmailSender` stub that records invocations, asserting: the handler calls `sendMagicLink` with the expected `to` matching the request email, the `verificationUrl` is well-formed and contains the issued token, `expiresInMinutes` matches the configured token TTL

### 7. Files to delete

- Any `resend.ts`, `resend-client.ts`, or equivalent Resend-specific integration module
- `RESEND_API_KEY` references in `wrangler.toml`, `.dev.vars.example`, README, and CI secret lists
- Any test fixtures or mocks targeting Resend specifically

### 8. Deploy-time checklist

Before pushing to staging:
- [ ] Emailit account has the sending domain verified (SPF, DKIM, DMARC DNS records added and verified in Emailit dashboard)
- [ ] `wrangler secret put EMAILIT_API_KEY --env staging` set with a scoped Emailit API key (not the account master key — create a dedicated key from the Emailit dashboard for this service)
- [ ] `MAGIC_LINK_FROM_ADDRESS` uses an address on the verified domain
- [ ] Staging smoke test: request a magic link to a real inbox, confirm delivery time < 30s, confirm the link works end-to-end
- [ ] Prod deploy repeats the same secret-set with a production-scoped Emailit key

### 9. Explicit non-goals for this change

To keep this PR reviewable and avoid scope creep:

- ❌ Do not build `email-gateway` or `email-svc` in this change — that is the next platform service, tracked separately
- ❌ Do not add Brevo, SES, or Cloudflare Email Service adapters yet — this change establishes the `EmailSender` interface but ships with only `EmailitSender` as an implementation
- ❌ Do not add a provider-routing layer, fallback chain, or retry logic beyond the single upstream call — those belong in the future `email-svc`
- ❌ Do not add webhook receivers for delivery events — that's also an `email-svc` concern
- ❌ Do not add per-tenant API key issuance — same reason
- ❌ Do not add email open/click tracking — explicitly out of scope for auth email (also worsens deliverability)

The goal of this change is **one thing**: unblock Auth Gateway by replacing Resend with Emailit, behind an interface that makes the future email-gateway migration a single-file change.

## Related

- PRD: `docs/prds/auth-platform-mvp.md` Section 11 (Email Delivery) — superseded by this ADR
- Future ADR (to be written): `0005-email-gateway-architecture.md` — will cover the full multi-provider, multi-tenant email-gateway/email-svc design once Auth ships
- Future ADR (to be written, post-GA): Cloudflare Email Service adoption as primary
