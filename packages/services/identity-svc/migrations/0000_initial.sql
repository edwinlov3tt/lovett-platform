-- 0000_initial.sql
--
-- @package @lovett/identity-svc
-- Initial schema for identity-db. Mirrors src/db/schema.ts (Drizzle).
-- Applied via `wrangler d1 migrations apply identity-db [--env …]`.
--
-- Notes:
--   - All timestamps are unix seconds (INTEGER).
--   - Tokens are stored as SHA-256 hashes (text), never plaintext.
--   - `org_id` defaults to 'default' — multi-org is deferred but the
--     column is here so the later migration is additive (new `orgs`
--     table + existing rows already point at the right string).

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
