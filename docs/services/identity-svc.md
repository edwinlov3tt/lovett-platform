# `identity-svc` — RPC Contract

**Binding name:** `IDENTITY` (by convention; actual name is the `binding` field in your `wrangler.toml`)
**Type:** `Service<IdentityService>` via the class type imported from `@lovett/identity-svc`
**Exposure:** internal only — no `routes` block, not reachable from the public internet
**Source of truth:** `@lovett/auth-types` exports every type referenced below

---

## How to bind from a new service

In `packages/services/<your-svc>/wrangler.toml`:

```toml
[[services]]
binding = "IDENTITY"
service = "identity-svc"
```

In `packages/services/<your-svc>/src/env.ts`:

```ts
import type { IdentityService } from "@lovett/identity-svc";

export interface Env {
  IDENTITY: Service<IdentityService>;
}
```

That's it. The import is types-only; your bundle doesn't include any `identity-svc` runtime code. Every call is a zero-network-hop RPC into the bound service's isolate — typically sub-millisecond.

---

## Method reference

All methods return `Promise<…>` (Workers RPC is async by nature).

### User operations

#### `findOrCreateUser({ email, orgId?, name? }): User`

Upserts a user by lowercased email. Creates on first call; stamps `emailVerifiedAt = now` atomically because callers only get here after the user proved inbox ownership (magic-link consumption).

- **orgId** defaults to `"default"` (MVP — multi-org deferred).
- **name** is optional; stored null if omitted.
- Returns the full `User` shape including all audit fields.

#### `getUser(userId): User | null`
#### `getUserByEmail(email): User | null`

Plain reads. `null` when not found — never throws for the "not found" case.

---

### Magic-link lifecycle

#### `createMagicLinkToken({ email, redirectUri?, ipAddress? }): { token, expiresAt }`

Mints a 32-byte random token, stores its SHA-256 hash, returns the plaintext **once**. `expiresAt` is unix seconds (15 minutes after issue).

Callers:
- Must treat the returned `token` as write-only — log it nowhere, store it nowhere, just stuff it into an email.
- Must validate `redirectUri` against their own allowlist BEFORE calling this. The Identity service stores whatever's passed in and hands it back on consume; it doesn't re-validate.

#### `consumeMagicLinkToken({ token, ipAddress? }): { email, redirectUri? } | null`

Single-use. Returns `null` for unknown / expired / already-used tokens (the RPC doesn't distinguish — callers shouldn't leak that distinction anyway for enumeration resistance). On success, the DB row is stamped `used_at = now` atomically.

Returned `email` is always lowercased.

---

### Session lifecycle

#### `issueSession({ userId, orgId, userAgent?, ipAddress? }): TokenPair`

Creates a new session row. Returns:

```ts
{
  accessToken: string;      // signed HS256 JWT, sub/org/role/sid/iat/exp/jti
  refreshToken: string;     // 32-byte random base64url
  expiresAt: number;        // unix seconds — access token
  refreshExpiresAt: number; // unix seconds — 7 days after issue
}
```

The `role` claim is resolved from the user row, not the caller. Passing a `role` override has no effect — this is deliberate (a buggy caller can't accidentally issue admin tokens for a regular user).

#### `validateSession(accessToken): ValidatedSession | null`

Verifies the JWT signature + expiry + issuer + audience, then checks the DB for `sessions.revoked_at IS NULL`. Null on any failure — callers treat null as 401.

Return shape:

```ts
{
  userId: string;
  orgId: string;
  role: string;
  sessionId: string;   // the `sid` claim, useful for audit logs
}
```

This is what downstream services call on every request to authorize the caller. Cost: ~1 D1 read.

#### `refreshSession(refreshToken): TokenPair | null`

Rotates. Returns a brand-new token pair + revokes the current session row. Null for:
- Not-found (bogus token)
- Expired (past `refreshExpiresAt`)
- Reuse (matched row is already revoked → attack signal, loudly logged)

Callers should NOT distinguish the null reasons in what they return to clients — treat every null as "clear cookies, send to /login".

#### `revokeSession(sessionId): void`
#### `revokeAllSessionsForUser(userId): void`

Idempotent — calling on an already-revoked session or a user with no active sessions is a no-op. Both set `revokedAt = now` on every matching row where `revokedAt IS NULL`.

---

### Health

#### `healthCheck(): { ok: true, ts: number }`

Lightweight ping. Also touches D1 with a `SELECT 1` so schema drift or binding misconfiguration surfaces at probe time. Used by Gateway `/healthz/full`.

---

## JWT claim shape

```json
{
  "iss": "lovett-platform",
  "aud": "lovett-services",
  "sub": "user_01HZ...",
  "org": "default",
  "role": "user",
  "sid": "sess_01HZ...",
  "jti": "<uuid-per-token>",
  "iat": 1713888000,
  "exp": 1713974400
}
```

- `iss` + `aud` are required by `validateSession` — tokens minted by other services with the same HS256 key but different iss/aud will be rejected.
- `jti` changes on every mint so successive access tokens for the same session are byte-distinct.
- `sid` identifies the session row for revocation lookups. `sub` identifies the user.

---

## What Identity does NOT do (explicit non-goals)

Don't try to call these — they don't exist and shouldn't be added until the corresponding PRD phase lands:

- ❌ Org creation / lookup / member management (Phase 5, Org service)
- ❌ SSO / OIDC / OAuth callbacks (Phase 6)
- ❌ Password verification (never — magic-link only)
- ❌ RBAC beyond `role: 'user' | 'admin'` (Phase 7)
- ❌ JWKS endpoint / asymmetric signing (Phase 8)
- ❌ API key issuance for external consumers (Phase 8)

If your service needs one of these, flag in the PRD rather than adding a method here.

---

## Error semantics

None of these methods throw in normal operation. Every failure path returns `null` or a discriminated union. The only throws you'll see in practice:

- `JwtSigner` constructor throws if `JWT_SECRET` is shorter than 32 chars (crash-on-boot, not a runtime concern after first deploy)
- `provisionXxx` helpers throw `Error` if their Nettu / external-call dependencies return non-2xx (not applicable to identity-svc itself yet)

Treat any uncaught error from an RPC as a 500/502 in your service.

---

## Observability contract

Every RPC call should log a single structured-JSON line with:

```json
{
  "type": "identity.<method>",
  "ts": 1713888000,
  "durationMs": 12,
  "result": "ok" | "error",
  "userId"?: string,
  "sessionId"?: string,
  "errorCode"?: string
}
```

And emit a CF Analytics Engine datapoint per the PRD §13 list (`auth.session.validated`, `auth.session.refreshed`, `auth.refresh.reuse_detected`, etc.). Identity's structured logs are the Usage service's first subscriber once that ships.

---

## Template when you add your own platform service

1. `packages/services/<name>/wrangler.toml`: add `[[services]] binding = "IDENTITY"` block
2. `src/env.ts`: type `IDENTITY: Service<IdentityService>` from the shared class type
3. Add a middleware that reads `lovett_session` cookie (or Authorization header), calls `env.IDENTITY.validateSession(token)`, attaches the result to the Hono context
4. 403 / 401 based on `result === null`
5. Log `{ type: "auth.session.validated", userId, sessionId }` per request

That's the whole pattern. Every service gets zero-network-hop session validation with four lines of code.
