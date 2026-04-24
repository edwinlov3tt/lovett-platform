/**
 * @package @lovett/identity-svc
 * @file test/setup.ts
 *
 * Shared helpers for spinning up an in-memory D1 database against the
 * 0000 schema. Vitest runs each test in a fresh Worker isolate via
 * @cloudflare/vitest-pool-workers, but D1 state is per-run so we reset
 * via `resetDb` before each test.
 */

import { env } from "cloudflare:test";

/**
 * Hardcoded mirror of `migrations/0000_initial.sql`. Workers runtime
 * doesn't support `readFileSync` at test time, so the DDL is inlined
 * here. If you change the migration, update this string — schema
 * drift between the two will surface as test failures against the
 * inlined copy.
 */
const MIGRATION_0000 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,
  name TEXT,
  org_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org ON users(org_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  access_token_hash TEXT,
  refresh_token_hash TEXT NOT NULL,
  refresh_token_generation INTEGER NOT NULL DEFAULT 1,
  user_agent TEXT,
  ip_address TEXT,
  expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_refresh ON sessions(refresh_token_hash);

CREATE TABLE magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  redirect_uri TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  ip_address TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_magic_email ON magic_link_tokens(email);
CREATE INDEX idx_magic_hash ON magic_link_tokens(token_hash);
`;

export const TEST_JWT_SECRET = "x".repeat(48); // meets JwtSigner's 32-char min

export interface TestEnv {
  DB: D1Database;
  JWT_SECRET: string;
}

export function getTestEnv(): TestEnv {
  // `env` from cloudflare:test carries the bindings declared in wrangler.toml.
  return {
    DB: (env as unknown as { DB: D1Database }).DB,
    JWT_SECRET: TEST_JWT_SECRET,
  };
}

/**
 * Drop + recreate the schema. Call inside beforeEach for isolation.
 * Uses `prepare(stmt).run()` per statement — miniflare's `exec()`
 * implementation doesn't reliably handle multi-line CREATE TABLE,
 * but prepared statements accept the same SQL cleanly.
 */
export async function resetDb(): Promise<void> {
  const db = getTestEnv().DB;

  // SQLite doesn't support `DROP SCHEMA`; drop tables individually.
  // Order matters: sessions references users.
  for (const table of ["sessions", "magic_link_tokens", "users"]) {
    await db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }

  const statements = MIGRATION_0000
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
}
