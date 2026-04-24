/**
 * @package @lovett/db-utils
 * @file src/ids.ts
 *
 * Prefixed identifier generation for all platform entities. The prefix
 * is part of the identity — `user_01H…` is unambiguously a user row,
 * `sess_01H…` is a session, etc. Grep-friendly when debugging logs.
 *
 * Implementation is a ULID variant: 48-bit millisecond timestamp +
 * 80 bits of cryptographic randomness, Crockford base32-encoded.
 * Sortable by creation time, which is useful for D1 cursor-based
 * pagination. Collisions are cryptographically infeasible.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Produces a 26-character ULID prefixed with `<prefix>_`.
 *
 * Example: `prefixedId("user")` → `user_01HZX3K9FA7P5Q6M4T7N8R9WXY`
 */
export function prefixedId(prefix: string): string {
  if (!/^[a-z][a-z0-9]*$/.test(prefix)) {
    throw new Error(`prefixedId: prefix must be [a-z][a-z0-9]*, got "${prefix}"`);
  }
  return `${prefix}_${ulid()}`;
}

export function ulid(nowMs: number = Date.now()): string {
  const time = encodeTime(nowMs, 10);
  const rand = encodeRandom(16);
  return `${time}${rand}`;
}

function encodeTime(ms: number, length: number): string {
  if (!Number.isInteger(ms) || ms < 0) throw new Error("ulid: time must be a non-negative integer");
  let out = "";
  let remaining = ms;
  for (let i = 0; i < length; i++) {
    const mod = remaining % 32;
    out = CROCKFORD[mod]! + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CROCKFORD[bytes[i]! & 0x1f];
  }
  return out;
}

// Prefix constants kept here so callers don't hand-type strings.
export const ID_PREFIX = {
  user: "user",
  session: "sess",
  magicLink: "mlink",
  org: "org",
} as const;
