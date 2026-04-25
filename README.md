# Lovett Platform

First service in a broader microservices platform. Every downstream service (Email, Upload, Brand Intel, Geo, KPI) depends on identity, so **auth ships first**.

```
┌────────────────────────────────────────────────────────────────┐
│   Public internet                                              │
│       │                                                        │
│       ▼                                                        │
│   auth-gateway          (public: auth.edwinlovett.com)         │
│       │                                                        │
│       │  Workers RPC via service binding                       │
│       ▼                                                        │
│   identity-svc          (internal, owns identity-db D1)        │
└────────────────────────────────────────────────────────────────┘
```

Two Workers. Gateway is public, Identity is internal — the Gateway never talks to D1 and the Identity service is never reachable from the internet. Other platform services (Upload, Email, etc.) will bind to Identity the same way to validate sessions — zero network hops, sub-millisecond.

## Repo layout

```
lovett-platform/
├── packages/
│   ├── services/
│   │   ├── auth-gateway/       # Hono Worker: public REST + HTML auth pages
│   │   └── identity-svc/       # WorkerEntrypoint: owns identity-db D1
│   ├── shared/
│   │   ├── auth-types/         # @lovett/auth-types — User, Session, IdentityRPC
│   │   └── db-utils/           # @lovett/db-utils — shared D1/Drizzle helpers
│   └── sdk/
│       └── auth/               # @lovett/auth — consumer SDK (core + /react)
├── apps/                       # empty; landing/registry site lands here later
├── .github/workflows/          # CI + path-filtered wrangler deploys
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── CLAUDE.md
```

## Quick start

```bash
# Prereqs: Node 20.11+, pnpm 10.18+, Wrangler authed to Cloudflare
nvm use                   # picks up .nvmrc
pnpm install              # workspace install

# Typecheck + test everything
pnpm typecheck
pnpm test

# Run identity-svc + auth-gateway locally (miniflare-backed)
pnpm dev
```

`pnpm dev` starts both Workers on local ports with the service binding wired up. See individual service READMEs for per-service targets.

## Env vars (Gateway)

Set via `wrangler secret put …` and `[env.X.vars]` in `wrangler.toml`. Nothing domain-specific is hardcoded — all values flow through env:

| Name | Where | Purpose |
|------|-------|---------|
| `JWT_SECRET` | secret | HS256 signing key (must match Identity) |
| `EMAILIT_API_KEY` | secret | Magic-link email via Emailit (see [ADR 0004](docs/services/0004-email-provider-strategy.md)) |
| `EMAILIT_API_BASE_URL` | var | Override Emailit base URL; defaults to `https://api.emailit.com/v2` |
| `MAGIC_LINK_FROM_ADDRESS` | var | e.g. `noreply@edwinlovett.app` (must be on the Emailit-verified sender domain) |
| `COOKIE_DOMAIN` | var | e.g. `.edwinlovett.com` — parent domain for cross-subdomain SSO |
| `ALLOWED_ORIGINS` | var | CORS allowlist, comma-separated |
| `ALLOWED_REDIRECT_HOSTS` | var | `redirect_uri` host allowlist, comma-separated |
| `PLATFORM_NAME` | var | UI copy, e.g. `Lovett Platform` |
| `GATEWAY_ORIGIN` | var | This Worker's public origin, e.g. `https://auth.edwinlovett.com` |

The full PRD is at `docs/AUTH_PLATFORM_PRD.md` (copy of the source PRD for in-repo reference).

## Deploys

GitHub Actions path-filtered:

- Push to `main` touching `packages/services/identity-svc/**` → deploy `identity-svc` to staging (auto) + production (manual dispatch)
- Same for `auth-gateway`
- Shared packages build on PRs; only services deploy

See `.github/workflows/deploy.yml`.

## Claude Code handoff

See `CLAUDE.md` for project-specific context (architecture rationale, RPC typing pattern, forbidden patterns, aesthetic rules for auth HTML).
