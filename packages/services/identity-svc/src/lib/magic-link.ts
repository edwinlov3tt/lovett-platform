/**
 * @package @lovett/identity-svc
 * @file src/lib/magic-link.ts
 *
 * Magic-link token lifecycle.
 *
 * - `create`: generates a 32-byte random token (43-char base64url),
 *   stores only the SHA-256 hash, returns plaintext ONCE so the
 *   Gateway can put it in an email.
 * - `consume`: re-hashes the incoming plaintext, looks up by hash,
 *   checks expiry + not-used, atomically marks `used_at`. Returns
 *   the email + original redirect_uri.
 *
 * Token lifetime: 15 minutes (hardcoded — it's a fundamental security
 * parameter, not a config knob). Single-use — `used_at` stamp makes
 * re-presentation impossible.
 */

import { and, eq, isNull } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import {
  ID_PREFIX,
  nowSeconds,
  prefixedId,
  randomTokenBase64url,
  sha256Hex,
  timingSafeEqual,
} from "@lovett/db-utils";
import { magicLinkTokens } from "../db/schema.js";

export const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const MAGIC_LINK_TOKEN_BYTES = 32;

export interface CreateResult {
  token: string;
  expiresAt: number;
}

export type ConsumeOutcome =
  | { ok: true; email: string; redirectUri: string | null }
  | { ok: false; reason: "not_found" | "expired" | "already_used" };

export class MagicLinkStore {
  readonly #db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.#db = drizzle(d1);
  }

  async create(params: {
    email: string;
    redirectUri?: string;
    ipAddress?: string;
  }): Promise<CreateResult> {
    const email = params.email.trim().toLowerCase();
    if (!email) throw new Error("magic-link create: email required");

    const token = randomTokenBase64url(MAGIC_LINK_TOKEN_BYTES);
    const tokenHash = await sha256Hex(token);
    const now = nowSeconds();
    const expiresAt = now + MAGIC_LINK_TTL_SECONDS;

    await this.#db
      .insert(magicLinkTokens)
      .values({
        id: prefixedId(ID_PREFIX.magicLink),
        email,
        tokenHash,
        redirectUri: params.redirectUri ?? null,
        expiresAt,
        usedAt: null,
        ipAddress: params.ipAddress ?? null,
        createdAt: now,
      })
      .run();

    return { token, expiresAt };
  }

  async consume(params: {
    token: string;
    ipAddress?: string;
  }): Promise<ConsumeOutcome> {
    const tokenHash = await sha256Hex(params.token);
    const now = nowSeconds();

    const rows = await this.#db
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];

    if (!row) return { ok: false, reason: "not_found" };
    // Defense-in-depth: re-compare the stored hash against our computed
    // hash using a constant-time operation. The initial DB lookup is
    // already an equality match, but SQLite's comparison isn't specified
    // as timing-safe. Doubling up here costs a handful of microseconds
    // and forecloses the byte-at-a-time timing attack class entirely.
    if (!timingSafeEqual(row.tokenHash, tokenHash)) {
      return { ok: false, reason: "not_found" };
    }
    if (row.usedAt !== null) return { ok: false, reason: "already_used" };
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };

    // Conditional update guards against concurrent consumption — if
    // two POSTs land within the same ms, only one wins the
    // `used_at IS NULL` match. The other returns 0 rows updated.
    const stamped = await this.#db
      .update(magicLinkTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(magicLinkTokens.tokenHash, tokenHash),
          isNull(magicLinkTokens.usedAt),
        ),
      )
      .run();

    if (stamped.meta.changes === 0) {
      // Lost the race — another request consumed it first.
      return { ok: false, reason: "already_used" };
    }

    return {
      ok: true,
      email: row.email,
      redirectUri: row.redirectUri ?? null,
    };
  }
}
