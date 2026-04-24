/**
 * @package @lovett/identity-svc
 * @file src/lib/jwt.ts
 *
 * HS256 JWT sign + verify using `jose`. Symmetric key because only
 * Identity signs AND only Identity verifies (other services call
 * `validateSession` RPC which verifies here). When external consumers
 * need offline verification we'll switch to EdDSA + JWKS — the jose
 * API makes that a drop-in swap.
 *
 * Caller contract: `JwtSigner` is instantiated per-request with the
 * env's `JWT_SECRET`. Don't cache instances across requests unless
 * the secret rotation story is explicit.
 */

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { JwtClaims } from "@lovett/auth-types";

export const JWT_ALGORITHM = "HS256" as const;
export const JWT_ISSUER = "lovett-platform";
export const JWT_AUDIENCE = "lovett-services";

export type VerifyFailure =
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "malformed" }
  | { ok: false; reason: "bad_signature" }
  | { ok: false; reason: "wrong_algorithm" };

export type VerifyResult =
  | { ok: true; claims: JwtClaims }
  | VerifyFailure;

export class JwtSigner {
  readonly #secret: Uint8Array;

  constructor(secret: string) {
    if (!secret || secret.length < 32) {
      // HS256 with a tiny secret is the all-too-common footgun. Refuse.
      throw new Error("JwtSigner: secret must be at least 32 chars");
    }
    this.#secret = new TextEncoder().encode(secret);
  }

  /**
   * Signs a JWT with the given claims. Enforces iat/exp consistency by
   * requiring the caller to supply `exp` explicitly — we don't infer
   * "24 hours from now" here because token lifetime is a session-layer
   * decision, not a crypto-layer one.
   */
  async sign(claims: JwtClaims): Promise<string> {
    return new SignJWT(claims as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
      .setIssuedAt(claims.iat)
      .setExpirationTime(claims.exp)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setSubject(claims.sub)
      .sign(this.#secret);
  }

  /**
   * Verifies a JWT. Returns a discriminated union so callers can
   * switch on the specific failure reason (important because
   * "expired" vs "bad_signature" have different audit semantics:
   * expired is benign, bad_signature is a possible attack).
   */
  async verify(token: string): Promise<VerifyResult> {
    try {
      const { payload } = await jwtVerify(token, this.#secret, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      // `jose` returns payload typed as JWTPayload (Record<string, unknown>).
      // We trust the fields we set at sign time — they're our own tokens.
      // Cast below is justified because `jwtVerify` already checked the
      // signature + issuer + audience; the shape-level guarantees come
      // from the claim builder in `sessions.ts`.
      return { ok: true, claims: payload as unknown as JwtClaims };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
      if (err instanceof joseErrors.JWSInvalid) return { ok: false, reason: "malformed" };
      if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
        return { ok: false, reason: "bad_signature" };
      }
      if (err instanceof joseErrors.JOSEAlgNotAllowed) return { ok: false, reason: "wrong_algorithm" };
      return { ok: false, reason: "malformed" };
    }
  }
}
