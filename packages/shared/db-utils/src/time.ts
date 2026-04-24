/**
 * @package @lovett/db-utils
 * @file src/time.ts
 *
 * Tiny time helpers. D1 stores timestamps as INTEGER (unix epoch).
 * We use *seconds* to match JWT `iat`/`exp` convention; everywhere
 * else in the codebase sticks to seconds too.
 *
 * If you need milliseconds (rare — only when interfacing with
 * Web APIs that demand them), convert at the call site.
 */

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function addSeconds(baseSeconds: number, deltaSeconds: number): number {
  return baseSeconds + deltaSeconds;
}

export function isExpired(expiresAt: number, nowSec: number = nowSeconds()): boolean {
  return expiresAt <= nowSec;
}

/** Returns the number of seconds until `expiresAt`, clamped at 0. */
export function secondsUntil(expiresAt: number, nowSec: number = nowSeconds()): number {
  return Math.max(0, expiresAt - nowSec);
}
