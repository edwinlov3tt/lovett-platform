/**
 * @package @lovett/db-utils
 * @file src/crypto.ts
 *
 * Primitive crypto helpers. All built on Web Crypto (`crypto.subtle`)
 * which is native in Workers + Node 20+.
 *
 * - `randomTokenBase64url(bytes)` — cryptographically-random URL-safe token
 * - `sha256Hex(input)` — SHA-256 → lowercase hex (for DB-stored token
 *    fingerprints, NEVER for password hashing; we don't do passwords)
 * - `timingSafeEqual(a, b)` — constant-time string compare for token
 *    verification paths. Matters because JS's `===` short-circuits on
 *    the first mismatched char and leaks timing info to attackers
 *    that can measure it cleverly.
 */

export function randomTokenBase64url(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes <= 0) {
    throw new Error(`randomTokenBase64url: bytes must be a positive integer, got ${bytes}`);
  }
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bufferToBase64Url(buf);
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Timing-safe string equality. Both inputs are compared byte-for-byte
 * in the same number of operations regardless of where they differ,
 * defeating timing-oracle attacks on secret comparisons.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!;
  }
  return diff === 0;
}

// ---- internals ----

function bufferToBase64Url(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}
