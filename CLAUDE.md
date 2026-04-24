# CLAUDE.md — Lovett Platform

Project-specific guidance for Claude Code. Read this before touching code.

## 1. What this is

A Cloudflare Workers microservices platform. Auth is the first service; it's the identity primitive every other service will bind to via **Workers RPC** (not fetch-over-HTTP — actual `WorkerEntrypoint` classes exposed through service bindings).

The architectural bet: a clean Gateway (public, Hono) + Identity (internal, RPC-only) split from day one. Every future service follows the same template.

## 2. Architecture — the non-negotiables

### The two-worker split

```
auth-gateway  (public, Hono)
    │
    │  env.IDENTITY  (Service<IdentityService>)
    ▼
identity-svc  (internal, WorkerEntrypoint)
    │
    ▼
identity-db   (D1)
```

- **Gateway never touches D1.** Every mutation goes through an Identity RPC call.
- **Identity is never internet-accessible.** No `[triggers]` route, no public domain, nothing exposed outside the CF account. Other services bind to it the same way Gateway does.
- **RPC is typed end-to-end.** `auth-gateway` imports the `IdentityService` class type from `@lovett/identity-svc` (type-only import). The binding is declared as `Service<IdentityService>` in the env shape, which gives full TypeScript autocomplete on the binding calls — no stringly-typed method names, no runtime reflection.

### Why the split, and why from day one

Rebuilding rather than porting the scheduler-app's auth feels slower day-one. But the RPC boundary IS the point. If Identity is a real service from commit one, every future service (Email, Upload, KPI) inherits the pattern. If we start with inline functions and split later, the split becomes a refactor project instead of an architecture.

## 3. Opinions set in the PRD (don't re-litigate)

- **HS256 JWT** (not RS256/EdDSA). Only Identity signs + validates. Move to JWKS+EdDSA when external consumers need offline verification.
- **DB-backed sessions** (not pure JWT). `validateSession` reads the DB row and checks `revoked_at IS NULL` — gives instant revocation at the cost of one D1 read, which is fine over RPC.
- **Magic link only** for MVP. No passwords, no SSO, no OAuth. Deferred to Phase 5+.
- **Hardcoded `org_id = 'default'`** on every user. Multi-org is additive later, not a schema restructure, because `org_id` is on every row from day one.
- **User created on `consumeMagicLinkToken` (POST)**, not on `createMagicLinkToken`. Typo'd emails don't leave orphan user rows; link scanners doing GETs can't create users.
- **Scanner-safe two-step verify.** GET `/auth/verify` renders a confirmation page with a button. POST `/auth/verify` consumes the token. Microsoft Defender / Proofpoint / Mimecast fetch URLs in emails — GET must be idempotent. Do not auto-consume on mount.
- **SameSite=Lax cookies** (not Strict). Magic-link flow requires the session to be established when the user arrives from an external-origin email link.
- **Cookie domain is env-driven**, not hardcoded. `COOKIE_DOMAIN=.edwinlovett.com` today; white-label a different customer later by changing one var.
- **Refresh token rotation with reuse detection.** Old generation reused = session revoked + loud log. It's an attack signal.

## 4. Explicit non-goals (don't build these, even if it's five minutes)

From the PRD §3 — quoted so nobody's tempted:

> Multi-org support. External SSO. OAuth sign-in. Password auth. MFA/TOTP/WebAuthn. Admin panel. Profile fields beyond email/name. RBAC beyond hardcoded `role:'user'`. BYO-DB. Worker-level rate limiting (Phase 4). KPI integration (emit events only). Asymmetric JWT/JWKS. API keys.

If you catch yourself building a config system for something that has one value, stop.

## 5. TypeScript discipline

- **`"strict": true`** in `tsconfig.base.json`. No loosening per-package.
- **No `any`.** Use `unknown` + narrow, or write the right type. If you need `as`, leave a one-line comment explaining why.
- **Zod on every public boundary.** Gateway request bodies, magic-link redirect URIs, anything coming from outside the Worker trust boundary. RPC call sites are internal — schema-validated only at the Gateway edge, trusted through the RPC hop.
- **Every source file starts with a header comment** describing its role and package:

```ts
/**
 * @package @lovett/identity-svc
 * @file src/lib/jwt.ts
 *
 * HS256 sign/verify using `jose`. Only Identity calls sign; validation
 * happens inside `validateSession` here too. The Gateway never verifies
 * JWTs directly — it calls `env.IDENTITY.validateSession(token)`.
 */
```

This is genuinely useful when you're jumping between services.

## 6. Reference project — use it correctly

The scheduler-app in `/Users/edwinlovettiii/scheduler-app` has a working auth flow with the same primitives we need here (magic link via Resend, HMAC JWT, Gate DO for single-use nonces, D1 migrations, etc.). Use it as a **pattern reference**, not a source to copy from:

- **Read its JWT helpers** (`apps/worker/src/lib/jwt-sign.ts`, `middleware/auth.ts`) for HS256 patterns — then rebuild here using `jose` instead of raw Web Crypto since `jose` is cleaner for production.
- **Read its email templating + Resend wrapper** (`apps/worker/src/lib/email.ts`, `email-templates.ts`) — then rebuild with our HTML aesthetic (light mode, not the scheduler's coral/dark mix).
- **Read its D1 migration pattern** (`apps/worker/migrations/0001_orgs_workspaces.sql` style + `scripts/d1-backfill-default.sh`) — then use Drizzle-generated migrations here, which is cleaner than hand-rolled SQL.
- **Read its two-step verify page** (`apps/web/app/login/verify/verify-card.tsx`) — that's the scanner-safe pattern we need, but here it's server-rendered HTML from the Gateway, not a Next.js client component.

The RPC split (Gateway vs Identity) is new and doesn't exist in scheduler-app. That architecture is this project's unique shape.

## 7. Aesthetic for auth HTML

Per PRD §19: **light mode, not dark.** The scheduler-app tools live in dark mode; the platform auth pages don't. Rationale: light mode communicates clarity and official-ness for auth flows specifically.

- White background (`#FFFFFF` body, optionally `#FAFAFA` card recess)
- Red accent: `#DC2626` primary, `#CF0E0F` hover
- Dark text: `#0A0A0A` primary, `#52525B` muted
- Inter or DM Sans
- No emojis, no decorative illustrations
- Single centered card, generous padding
- One clear primary action per page
- Muted legalese line below the card

Pages: `/login`, `/auth/verify` (confirmation), `/auth/error`. These are HTML strings served from the Gateway. No client-side framework; this is the minimum viable trust layer.

## 8. Tests

Every RPC method on `IdentityService` gets at least two tests: happy path and one failure path (expired token, revoked session, invalid input). Gateway integration tests can use a mock Identity binding — write it once as a helper.

- Framework: **vitest** (works in Workers context via `@cloudflare/vitest-pool-workers` when we need real bindings; plain vitest is fine for pure unit tests).
- No test uses the real Resend API, real Cloudflare API, or real DNS. Mock them.

## 9. Commit style + workflow

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). One logical change per commit.
- Each PRD phase (0, 1, 2, 3, 4) ends with a reviewable PR that's its own unit.
- Never skip `pnpm typecheck && pnpm test` before committing.
- `wrangler deploy` is CI-driven; don't deploy from local unless it's explicitly a debugging session (and revert to CI-driven after).

## 10. When Claude is uncertain

- **Ask before adding anything from the non-goals list.**
- **Ask before adding a dependency** that isn't already in `package.json`. The MVP's dep surface is small on purpose.
- **Flag scope creep loudly.** If a "small" change touches more than one service, it's probably not small.
