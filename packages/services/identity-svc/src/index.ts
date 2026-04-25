/**
 * @package @lovett/identity-svc
 * @file src/index.ts
 *
 * `IdentityService` — the WorkerEntrypoint exposed through service
 * bindings. This file is the single entry point the Cloudflare runtime
 * loads, and the only thing auth-gateway (and any future platform
 * service) calls.
 *
 * Type-only re-export of `IdentityService` lets consumers import the
 * class *type* and type their binding as `Service<IdentityService>`:
 *
 *   import type { IdentityService } from '@lovett/identity-svc';
 *   env: { IDENTITY: Service<IdentityService> }
 *
 * No runtime code from this package ends up in the Gateway's bundle —
 * the import is tree-shaken because it's types-only.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  ConsumeMagicLinkParams,
  ConsumeMagicLinkResult,
  CreateMagicLinkParams,
  CreateMagicLinkResult,
  FindOrCreateUserParams,
  IssueSessionParams,
  PublicUser,
  TokenPair,
  User,
  ValidatedSession,
} from "@lovett/auth-types";
import { JwtSigner } from "./lib/jwt.js";
import { MagicLinkStore } from "./lib/magic-link.js";
import { SessionStore } from "./lib/sessions.js";
import { UserRepo } from "./lib/users.js";

export interface Env {
  DB: D1Database;
  /** HS256 secret. Must match auth-gateway's (they never diverge). */
  JWT_SECRET: string;
}

/**
 * WorkerEntrypoint subclass — every `async` method is callable over an
 * RPC service binding. Instance state is per-request (the runtime
 * creates a new instance per incoming RPC invocation), which means the
 * constructor runs every call. Keep it cheap.
 */
export class IdentityService extends WorkerEntrypoint<Env> {
  // ---- User operations -------------------------------------------------

  async findOrCreateUser(params: FindOrCreateUserParams): Promise<User> {
    return this.#userRepo.findOrCreate(params);
  }

  async getUser(userId: string): Promise<User | null> {
    return this.#userRepo.findById(userId);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return this.#userRepo.findByEmail(email);
  }

  // ---- Magic link lifecycle -------------------------------------------

  async createMagicLinkToken(params: CreateMagicLinkParams): Promise<CreateMagicLinkResult> {
    return this.#magicLinkStore.create(params);
  }

  async consumeMagicLinkToken(
    params: ConsumeMagicLinkParams,
  ): Promise<ConsumeMagicLinkResult | null> {
    const result = await this.#magicLinkStore.consume(params);
    if (!result.ok) return null;
    return { email: result.email, redirectUri: result.redirectUri ?? undefined };
  }

  // ---- Session lifecycle ----------------------------------------------

  async issueSession(params: IssueSessionParams): Promise<TokenPair> {
    // Resolve role from the user row so we don't let callers override it.
    const user = await this.#userRepo.findById(params.userId);
    const role = user?.role ?? "user";
    return this.#sessionStore.issue({
      userId: params.userId,
      orgId: params.orgId,
      role,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
    });
  }

  async validateSession(accessToken: string): Promise<ValidatedSession | null> {
    return this.#sessionStore.validate(accessToken);
  }

  async refreshSession(refreshToken: string): Promise<TokenPair | null> {
    const result = await this.#sessionStore.refresh(refreshToken);
    if (!result.ok) {
      if (result.reason === "reuse_detected") {
        // Loudly log — this is a security event worth alerting on.
        console.error("[identity] auth.refresh.reuse_detected");
      }
      return null;
    }
    return result.tokens;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.#sessionStore.revoke(sessionId);
  }

  async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.#sessionStore.revokeAllForUser(userId);
  }

  // ---- Projections ----------------------------------------------------

  toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      orgId: user.orgId,
      role: user.role,
    };
  }

  // ---- Health --------------------------------------------------------

  /**
   * Liveness ping. Called over RPC by Gateway `/healthz` to verify the
   * full chain (Gateway → binding → Identity → D1) is reachable.
   */
  async healthCheck(): Promise<{ ok: true; ts: number }> {
    // Touch D1 so we catch schema drift early.
    await this.env.DB.prepare("SELECT 1").first();
    return { ok: true, ts: Math.floor(Date.now() / 1000) };
  }

  // ---- Public HTTP surface (deliberately hostile) ---------------------
  //
  // Identity is internal-only. There's no `routes` block and no custom
  // domain — the only way traffic ever reaches this method is via the
  // workers.dev URL, which should never be hit by anything legitimate.
  // We answer 403 with no body so probes get nothing useful; the class
  // is still callable over RPC service bindings, which is the only
  // sanctioned entry path. Declaring `fetch` here also satisfies
  // wrangler's "script has at least one registered handler" check when
  // publishing a Worker whose surface is otherwise RPC-only.
  override async fetch(): Promise<Response> {
    return new Response("forbidden", { status: 403 });
  }

  // ---- Lazy collaborators ---------------------------------------------
  //
  // Allocated per-call. All use `this.env.DB` + `this.env.JWT_SECRET`,
  // both provided by the runtime on the WorkerEntrypoint base class.

  get #userRepo(): UserRepo {
    return new UserRepo(this.env.DB);
  }
  get #magicLinkStore(): MagicLinkStore {
    return new MagicLinkStore(this.env.DB);
  }
  get #sessionStore(): SessionStore {
    return new SessionStore(this.env.DB, new JwtSigner(this.env.JWT_SECRET));
  }
}

export default IdentityService;
