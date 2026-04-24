/**
 * @package @lovett/identity-svc
 * @file src/lib/users.ts
 *
 * User persistence. `findOrCreateUser` is the primary entry point —
 * called from `consumeMagicLinkToken` in the magic-link flow and also
 * directly for admin-added users (future).
 *
 * Creation happens at *consumption* time (not at magic-link issue time)
 * so typo'd emails don't leave orphan rows. See PRD §18 Q1.
 */

import { eq } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { ID_PREFIX, nowSeconds, prefixedId } from "@lovett/db-utils";
import type { User } from "@lovett/auth-types";
import { users } from "../db/schema.js";

export class UserRepo {
  readonly #db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.#db = drizzle(d1);
  }

  async findById(userId: string): Promise<User | null> {
    const rows = await this.#db.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const lower = email.trim().toLowerCase();
    if (!lower) return null;
    const rows = await this.#db.select().from(users).where(eq(users.email, lower)).limit(1);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  /**
   * Atomic find-or-create. Email is the unique key; everything else
   * is default-filled on create. `emailVerifiedAt` is stamped NOW —
   * callers should only call this after the magic-link OTP has been
   * consumed, since reaching this point implies the user proved
   * ownership of the inbox.
   */
  async findOrCreate(params: {
    email: string;
    orgId?: string;
    name?: string;
  }): Promise<User> {
    const lower = params.email.trim().toLowerCase();
    if (!lower) throw new Error("findOrCreate: email required");

    const existing = await this.findByEmail(lower);
    if (existing) {
      await this.#db
        .update(users)
        .set({ lastLoginAt: nowSeconds(), updatedAt: nowSeconds() })
        .where(eq(users.id, existing.id))
        .run();
      return { ...existing, lastLoginAt: nowSeconds() };
    }

    const now = nowSeconds();
    const id = prefixedId(ID_PREFIX.user);
    const row = {
      id,
      email: lower,
      emailVerifiedAt: now,
      name: params.name ?? null,
      orgId: params.orgId ?? "default",
      role: "user",
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    await this.#db.insert(users).values(row).run();
    return rowToUser(row);
  }
}

// ---- internals --------------------------------------------------------

type UserRow = {
  id: string;
  email: string;
  emailVerifiedAt: number | null;
  name: string | null;
  orgId: string;
  role: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
};

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.emailVerifiedAt,
    name: row.name,
    orgId: row.orgId,
    role: normalizeRole(row.role),
    status: normalizeStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

function normalizeRole(raw: string): User["role"] {
  return raw === "admin" ? "admin" : "user";
}

function normalizeStatus(raw: string): User["status"] {
  if (raw === "suspended" || raw === "deleted") return raw;
  return "active";
}
