/**
 * @package @lovett/identity-svc
 * @file src/db/schema.ts
 *
 * Drizzle ORM schema for `identity-db`. Mirror of the PRD §5 spec.
 *
 * Times are unix *seconds* everywhere (matches JWT iat/exp convention).
 * All tokens are stored as their SHA-256 hash — plaintext is only ever
 * in transit (email body, response payload). If the DB is ever dumped
 * the hashes can't be used to authenticate.
 *
 * `org_id` is on every row from day one even though MVP only uses
 * `'default'`. Adds ~10 bytes per row — trivially cheap — and turns
 * "add multi-org later" from a schema migration into an INSERT into
 * a new `orgs` table + existing rows already point at the right org.
 */

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    emailVerifiedAt: integer("email_verified_at"),
    name: text("name"),
    orgId: text("org_id").notNull().default("default"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastLoginAt: integer("last_login_at"),
  },
  (t) => ({
    emailIdx: index("idx_users_email").on(t.email),
    orgIdx: index("idx_users_org").on(t.orgId),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    /**
     * Optional — populated only if we ever need to revoke a specific
     * access token without revoking the whole session. Not strictly
     * required for MVP (sid-based validation covers it), but the
     * column's here so future revocation primitives can key on it.
     */
    accessTokenHash: text("access_token_hash"),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    /**
     * Generation counter — incremented on every refresh rotation.
     * If a stale (old-generation) refresh token is ever presented,
     * that's a signal the session was compromised: revoke it and
     * emit `auth.refresh.reuse_detected`.
     */
    refreshTokenGeneration: integer("refresh_token_generation").notNull().default(1),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    /** Unix seconds — access token expiry. */
    expiresAt: integer("expires_at").notNull(),
    /** Unix seconds — refresh token expiry (7d by default). */
    refreshExpiresAt: integer("refresh_expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    userIdx: index("idx_sessions_user").on(t.userId),
    refreshIdx: index("idx_sessions_refresh").on(t.refreshTokenHash),
  }),
);

export const magicLinkTokens = sqliteTable(
  "magic_link_tokens",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    redirectUri: text("redirect_uri"),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    ipAddress: text("ip_address"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    emailIdx: index("idx_magic_email").on(t.email),
    hashIdx: index("idx_magic_hash").on(t.tokenHash),
  }),
);

// Runtime no-op; exists so `drizzle-kit` emits the migration with the
// intended casing of the default string.
export const SCHEMA_DEFAULTS = sql`DEFAULT 'default'`;
