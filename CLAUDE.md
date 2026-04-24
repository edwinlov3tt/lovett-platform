# CLAUDE.md — Lovett Platform

Project-specific context for Claude Code. Read this first — it covers what the project is, what's built, what's still needed to deploy, and the non-negotiables that shouldn't be re-litigated.

---

## 1. The general idea

Lovett Platform is a **Cloudflare Workers microservices platform**. Auth is the first service; every downstream service (Email, Upload, Brand Intel, Geo, KPI) will follow the same template and bind to Auth for session validation.

The architectural bet from day one: a clean **Gateway / Internal-service split connected by Workers RPC** (not fetch-over-HTTP — actual `WorkerEntrypoint` classes exposed through service bindings).

```
┌────────────────────────────────────────────────────────────────┐
│   Public internet                                              │
│       │                                                        │
│       ▼                                                        │
│   auth-gateway          (public: auth.edwinlovett.com)         │
│       │                                                        │
│       │  env.IDENTITY — Service<IdentityService>               │
│       ▼                                                        │
│   identity-svc          (internal, owns identity-db D1)        │
│       │                                                        │
│       ▼                                                        │
│   identity-db           (D1)                                   │
└────────────────────────────────────────────────────────────────┘
```

- **Gateway is public** (Hono, HTML pages + JSON API) and owns HTTP, cookies, CORS, Resend email sends.
- **Identity is internal-only** — no `routes` block in its wrangler config, not reachable from the internet. Other platform services bind to it the same way Gateway does, which is the whole payoff: zero network hops, sub-ms session validation.
- **Types cross, code doesn't.** Gateway imports `IdentityService` as a type-only import from `@lovett/identity-svc`, gets full autocomplete on `env.IDENTITY.validateSession(...)`, but the Gateway bundle contains no identity-svc runtime code.

Paired with this repo is the consumer SDK (`@lovett/auth`) that any tool on `*.edwinlovett.com` drops in to get session-aware rendering, automatic refresh, and a one-line redirect to the Gateway's `/login`. The React subpath (`@lovett/auth/react`) ships `useSession` + `useUser` built on `useSyncExternalStore`.

---

## 2. Folder structure

```
lovett-platform/
├── packages/
│   ├── services/
│   │   ├── auth-gateway/           # Public Hono Worker
│   │   │   ├── src/
│   │   │   │   ├── index.ts        # Hono bootstrap + middleware order + error handling
│   │   │   │   ├── env.ts          # Env type (IDENTITY binding, secrets, vars)
│   │   │   │   ├── constants.ts    # ACCESS_TTL, REFRESH_TTL (mirrors identity-svc)
│   │   │   │   ├── routes/         # magic-link, verify, session, refresh, logout
│   │   │   │   ├── middleware/     # request-id, cors, logging
│   │   │   │   ├── lib/            # cookies, redirect-validator, email (Resend), errors, email-template
│   │   │   │   └── pages/          # Light-mode HTML: shared chrome + login + verify + error
│   │   │   ├── test/               # 31 tests: security, CSRF, CORS, cookies, e2e, fake-identity stub
│   │   │   ├── wrangler.toml
│   │   │   └── vitest.config.ts
│   │   │
│   │   └── identity-svc/           # Internal-only WorkerEntrypoint
│   │       ├── src/
│   │       │   ├── index.ts        # IdentityService class (RPC surface) + Env type
│   │       │   ├── db/schema.ts    # Drizzle ORM schema (users, sessions, magic_link_tokens)
│   │       │   └── lib/            # jwt, users, magic-link, sessions
│   │       ├── migrations/
│   │       │   └── 0000_initial.sql
│   │       ├── test/               # 21 tests: jwt, magic-link, sessions (+ reuse-detection)
│   │       ├── wrangler.toml       # NO routes block — internal only
│   │       ├── vitest.config.ts    # Uses @cloudflare/vitest-pool-workers for real D1
│   │       └── drizzle.config.ts
│   │
│   ├── shared/
│   │   ├── auth-types/             # @lovett/auth-types — shared between services + SDK
│   │   │   └── src/
│   │   │       ├── user.ts         # User, PublicUser, roles, status
│   │   │       ├── session.ts      # JwtClaims, TokenPair, ValidatedSession
│   │   │       ├── rpc.ts          # IdentityRPC interface contract
│   │   │       ├── errors.ts       # AuthErrorCode enum + httpStatusForCode
│   │   │       └── gateway-api.ts  # Zod schemas for Gateway HTTP surface
│   │   │
│   │   └── db-utils/               # @lovett/db-utils — ULIDs, crypto, time helpers
│   │       └── src/
│   │           ├── ids.ts          # prefixedId(prefix) — ULID-variant, grep-friendly
│   │           ├── crypto.ts       # randomTokenBase64url, sha256Hex, timingSafeEqual
│   │           └── time.ts         # nowSeconds, addSeconds, isExpired
│   │
│   └── sdk/
│       └── auth/                   # @lovett/auth — consumer SDK
│           ├── src/
│           │   ├── client.ts       # AuthClient: getSession, subscribe, refresh, signOut
│           │   ├── index.ts        # core exports (framework-agnostic)
│           │   └── react/          # /react subpath: AuthProvider, useSession, useUser
│           └── package.json        # "exports" field + optional React peer dep
│
├── apps/                           # Empty for now; landing/registry site goes here later
│
├── docs/
│   └── services/
│       └── identity-svc.md         # RPC contract reference — read before binding from a new service
│
├── scripts/
│   └── preview-auth-pages.mjs      # `pnpm preview:auth` — renders HTML to .previews/ + opens in Chrome
│
├── .github/workflows/
│   ├── ci.yml                      # lint / typecheck / test on PRs + main
│   └── deploy.yml                  # path-filtered wrangler deploys per service
│
├── .previews/                      # Gitignored. Output of `pnpm preview:auth`.
│
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .nvmrc                          # 20.11.0
├── README.md
└── CLAUDE.md                       # this file
```

---

## 3. Current state (as of this CLAUDE.md)

**Built + tested locally. Not yet deployed.**

| Slice | State |
|---|---|
| Workspace + tooling (pnpm + Turbo + TS) | ✅ |
| `@lovett/auth-types` | ✅ |
| `@lovett/db-utils` | ✅ |
| `identity-svc` (schema + lib + WorkerEntrypoint + 21 tests) | ✅ |
| `auth-gateway` (routes + middleware + HTML pages + 31 tests) | ✅ |
| `@lovett/auth` SDK (core + /react + 3 smoke tests) | ✅ |
| CI workflow (`ci.yml`) | ✅ |
| Deploy workflow (`deploy.yml`, path-filtered) | ✅ |
| Identity RPC contract doc (`docs/services/identity-svc.md`) | ✅ |
| `pnpm preview:auth` live-HTML preview script | ✅ |
| **Total tests** | **55 / 55 passing** |
| **Typecheck** | **5 / 5 packages clean** |
| First deploy to CF | ⏳ pending tokens + D1 provisioning |
| Resend domain verification | ⏳ pending |
| Error alerting wire-up | ⏳ pending |
| SDK integration in a real tool | ⏳ pending (first candidate: `tools.edwinlovett.com`) |

Latest commits (on `main`):

```
6a8ff33  chore(scripts): preview-auth-pages — render gateway HTML to .previews/
e6a372c  security+docs: pre-deploy hardening pass
7830a07  feat: initial Lovett Platform — auth-gateway + identity-svc MVP
```

---

## 4. What's still needed to deploy

This is the pre-flight checklist. Nothing deploys until these are in place.

### Generate locally (save in password manager)

| Value | How | Notes |
|---|---|---|
| `JWT_SECRET_STAGING` | `openssl rand -base64 48` | Must be identical in `identity-svc` AND `auth-gateway` on staging |
| `JWT_SECRET_PRODUCTION` | `openssl rand -base64 48` | Must be identical in both services on prod |

### Get from third-party dashboards

| Value | Where |
|---|---|
| Resend API key (staging) | https://resend.com/api-keys |
| Resend API key (production) | https://resend.com/api-keys |
| Resend verified domain | https://resend.com/domains — verify `edwinlovett.com` (DNS TXT + DKIM). `noreply@edwinlovett.com` won't send until this is done. |
| Cloudflare API token | https://dash.cloudflare.com/profile/api-tokens — "Edit Cloudflare Workers" template |
| Cloudflare Account ID | https://dash.cloudflare.com right sidebar |

### Provision via Wrangler (from `packages/services/identity-svc`)

```bash
npx wrangler d1 create identity-db --env staging
# Paste returned database_id into wrangler.toml under [[env.staging.d1_databases]]

npx wrangler d1 create identity-db --env production
# Paste returned database_id into wrangler.toml under [[env.production.d1_databases]]

# Apply migrations to each env (remote D1)
npx wrangler d1 migrations apply identity-db --env staging --remote
npx wrangler d1 migrations apply identity-db --env production --remote
```

Commit the `wrangler.toml` update — database IDs are routing data, not secrets.

### Push secrets via `wrangler secret put`

```bash
# identity-svc
cd packages/services/identity-svc
npx wrangler secret put JWT_SECRET --env staging          # paste JWT_SECRET_STAGING
npx wrangler secret put JWT_SECRET --env production       # paste JWT_SECRET_PRODUCTION

# auth-gateway
cd ../auth-gateway
npx wrangler secret put JWT_SECRET --env staging          # SAME value as identity-svc staging
npx wrangler secret put JWT_SECRET --env production       # SAME value as identity-svc prod
npx wrangler secret put RESEND_API_KEY --env staging
npx wrangler secret put RESEND_API_KEY --env production
```

### GitHub repo secrets

Settings → Secrets and variables → Actions → New repository secret:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Without these, `.github/workflows/deploy.yml` fails with 401 from CF.

### DNS / custom domains

Cloudflare dashboard → Workers & Pages → select the deployed Gateway Worker → Triggers → Add Custom Domain:

- Staging: `auth-staging.edwinlovett.com`
- Production: `auth.edwinlovett.com`

SSL auto-provisions. Resend's DNS records also go on `edwinlovett.com` (SPF + DKIM + return-path).

### Non-secret env vars already in `wrangler.toml`

Review + edit before first deploy — they're defaults, not facts:

| Var | Default | Used for |
|---|---|---|
| `MAGIC_LINK_FROM_ADDRESS` | `noreply@edwinlovett.com` | Resend "from" header |
| `COOKIE_DOMAIN` | `.edwinlovett.com` | Cookies scoped to parent domain for cross-subdomain SSO |
| `ALLOWED_ORIGINS` | `https://*.edwinlovett.com` | CORS allowlist |
| `ALLOWED_REDIRECT_HOSTS` | `edwinlovett.com` | Redirect-URI host suffix allowlist |
| `PLATFORM_NAME` | `Lovett Platform` | UI copy |
| `GATEWAY_ORIGIN` | `https://auth.edwinlovett.com` | Used in email magic-link URLs |

---

## 5. Architecture — the non-negotiables

### Two-Worker split, RPC-typed

- **Gateway never touches D1.** Every mutation goes through an Identity RPC call.
- **Identity is never internet-accessible.** No `routes` block, no public domain. Other services bind to it the same way Gateway does.
- **RPC is typed end-to-end.** `auth-gateway` imports the `IdentityService` class type from `@lovett/identity-svc` (type-only). The binding is declared as `Service<IdentityService>` in the env shape, giving full autocomplete with no runtime dependency.

### Why the split from day one

Rebuilding rather than inlining feels slower day-one. But the RPC boundary IS the point. If Identity is a real service from commit one, every future service (Email, Upload, KPI) inherits the pattern. If we start with inline functions and split later, it becomes a refactor project instead of an architecture.

---

## 6. Opinions locked in — don't re-litigate

- **HS256 JWT** (not RS256/EdDSA). Only Identity signs + validates. Switch to JWKS+EdDSA if/when external consumers need offline verification.
- **DB-backed sessions.** `validateSession` reads the DB row and checks `revoked_at IS NULL` — gives instant revocation. One D1 read per call, fine over RPC.
- **Magic link only** for MVP. No passwords, no SSO, no OAuth. Deferred to Phase 5+.
- **Hardcoded `org_id = 'default'`** on every user. Multi-org is additive later, not a schema restructure.
- **User created on `consumeMagicLinkToken` (POST)**, not at issue. Typo'd emails don't leave orphan rows; link scanners doing GETs can't create users.
- **Scanner-safe two-step verify.** GET `/auth/verify` renders confirmation, POST consumes. Defeats Microsoft Defender / Proofpoint / Mimecast pre-click scanning.
- **`SameSite=Lax` cookies** (not Strict). Magic-link flow requires the session to be established when the user arrives from an external email origin.
- **Cookie domain is env-driven**, not hardcoded. `COOKIE_DOMAIN=.edwinlovett.com` today; change one var to white-label.
- **Refresh rotation with reuse detection.** Old generation reused → session revoked + loud log. Attack signal.
- **CSRF via Origin-header check** on POST /auth/verify. Accept missing-Origin (Safari), reject mismatched.
- **Timing-safe hash compare** on magic-link consume (defense-in-depth on top of indexed DB lookup).

---

## 7. Explicit non-goals — don't build these

From the PRD §3, repeated here so no one's tempted:

> Multi-org support. External SSO. OAuth sign-in. Password auth. MFA / TOTP / WebAuthn. Admin panel. Profile fields beyond email/name. RBAC beyond hardcoded `role: 'user'`. BYO-DB. Worker-level rate limiting (Phase 4 — Cloudflare Rules until then). KPI integration (emit events only). Asymmetric JWT / JWKS. API keys.

If you catch yourself building a config system for something that has one value, stop.

---

## 8. TypeScript discipline

- **`"strict": true`** in `tsconfig.base.json`. No per-package loosening.
- **No `any`.** Use `unknown` + narrow, or write the right type. If you need `as`, leave a one-line comment explaining why.
- **Zod on every public boundary.** Gateway request bodies, magic-link redirect URIs, anything crossing the Worker trust boundary. RPC calls are internal — schema-validated at the Gateway edge, trusted through the RPC hop.
- **Every source file starts with a header comment** describing its role and package:

```ts
/**
 * @package @lovett/identity-svc
 * @file src/lib/jwt.ts
 *
 * HS256 sign/verify using jose. Only Identity calls sign; verification
 * happens inside validateSession here too. The Gateway never verifies
 * JWTs directly — it calls env.IDENTITY.validateSession(token).
 */
```

This pays off when jumping between packages.

---

## 9. Reference project — use it correctly

The scheduler-app in `/Users/edwinlovettiii/scheduler-app` has a working auth flow with similar primitives (magic link via Resend, HMAC JWT, Gate DO for single-use nonces, D1 migrations). Use it as a **pattern reference**, not a source to copy from:

- **JWT helpers** (`apps/worker/src/lib/jwt-sign.ts`, `middleware/auth.ts`) — read for HS256 patterns; we use `jose` here instead of raw Web Crypto.
- **Email templating + Resend wrapper** (`apps/worker/src/lib/email.ts`) — we ported the shape here but in light mode, not the scheduler's coral/dark.
- **Two-step verify page** (`apps/web/app/login/verify/verify-card.tsx`) — that's the scanner-safe pattern; here it's server-rendered HTML from the Gateway, not a Next.js client component.

The RPC split (Gateway vs Identity) is new and doesn't exist in scheduler-app. That architecture is this project's unique shape.

---

## 10. Aesthetic for auth HTML

Per PRD §19: **light mode**, not dark. The scheduler-app tools live in dark mode; platform auth pages don't. Rationale: light mode reads as clarity + official-ness for auth flows.

- White background (`#FFFFFF` body, `#FAFAFA` card recess)
- Red accent: `#DC2626` primary, `#CF0E0F` hover
- Dark text: `#0A0A0A` primary, `#52525B` muted
- Inter font
- No emojis, no decorative illustrations
- Single centered card, generous padding, one clear primary action
- Muted legalese line below the card
- `color-scheme: light only` on `<html>` — prevents browser-level form field inversion on dark-mode OS

Pages: `/login`, `/auth/verify` (confirmation), `/auth/error`. HTML strings served from the Gateway — no client-side framework. Preview any time with `pnpm preview:auth`.

---

## 11. Tests

Every RPC method on `IdentityService` has at least two tests: happy path and one failure path (expired token, revoked session, invalid input). Gateway integration tests use a mock Identity binding (`test/fake-identity.ts`).

- Framework: **vitest** (via `@cloudflare/vitest-pool-workers` for identity-svc — needs real D1; plain vitest for Gateway since it uses the fake).
- `identity-svc` vitest config uses `singleWorker: true` + `isolatedStorage: false` — this sidesteps a miniflare cleanup quirk with D1's WAL files. We explicitly reset the DB in `beforeEach` instead.
- No test uses real Resend / real Cloudflare API / real DNS. Everything mockable.

Current counts: `identity-svc` 21 · `auth-gateway` 31 · `@lovett/auth` 3 · total **55**.

---

## 12. Commit style + workflow

- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`). One logical change per commit.
- Run `pnpm typecheck && pnpm test` before committing. Both should be green.
- `wrangler deploy` is CI-driven — don't deploy from local unless debugging, and revert to CI after.
- Each PRD phase (0, 1, 2, 3, 4) ends with a reviewable PR that's its own unit.

---

## 13. When in doubt — ask

- **Ask before adding anything from the non-goals list.**
- **Ask before adding a dependency.** The MVP's surface is small on purpose; every dep is a liability.
- **Flag scope creep loudly.** If a "small" change touches more than one service, it's probably not small.
- **Don't silently paper over a failing test** — investigate. The tests catch real bugs (the reuse-detection rewrite during the first build pass was exactly this pattern).

---

## 14. Useful commands

```bash
# From repo root
pnpm install                     # first-time or after dep changes
pnpm typecheck                   # all 5 packages
pnpm test                        # all 3 test-enabled packages
pnpm preview:auth                # regenerate + open auth HTML pages in Chrome

# identity-svc specifics
cd packages/services/identity-svc
pnpm dev                         # wrangler dev on :8788
pnpm db:generate                 # drizzle-kit from schema.ts → new migration file
pnpm db:migrate:local            # apply to local miniflare D1
pnpm db:migrate:staging          # apply to remote staging D1

# auth-gateway specifics
cd packages/services/auth-gateway
pnpm dev                         # wrangler dev on :8787
pnpm deploy:staging              # wrangler deploy --env staging
pnpm deploy:production           # wrangler deploy --env production
```
