/**
 * @package @lovett/auth
 * @file src/client.ts
 *
 * Framework-agnostic auth client. Wraps the Gateway's public JSON API
 * in a small reactive store: callers subscribe for session changes,
 * initiate sign-in via `redirectToLogin`, sign out via `signOut`.
 *
 * Internal behavior (PRD §14):
 *   - On creation, fetches `{gateway}/auth/session` with `credentials: 'include'`.
 *   - If 401, attempts `/auth/refresh` once before declaring not-signed-in.
 *   - Schedules a refresh ~60s before access-token expiry.
 *   - Caches session in memory. No localStorage — HttpOnly cookies are
 *     the source of truth; the SDK only mirrors them in memory.
 */

import type { PublicUser, SessionResponse } from "@lovett/auth-types";

export interface AuthClientOptions {
  /** Base origin of the Gateway, e.g. `https://auth.edwinlovett.com` (no trailing slash). */
  gateway: string;
  /** Optional fetch override — use for tests or instrumentation. */
  fetch?: typeof fetch;
  /**
   * Refresh this many seconds before the access token's `exp`.
   * Default 60. Smaller = more refresh requests; larger = risk of
   * an expired token landing in a slow request.
   */
  refreshLeadSeconds?: number;
}

export interface Session {
  user: PublicUser;
  /** Unix seconds — when the current access token expires. */
  expiresAt: number;
}

/** Subscriber callback. Receives the current session (or null). */
export type SessionListener = (session: Session | null) => void;
export type Unsubscribe = () => void;

export class AuthClient {
  readonly #gateway: string;
  readonly #fetch: typeof fetch;
  readonly #refreshLeadSeconds: number;
  #session: Session | null = null;
  #loaded = false;
  #inFlight: Promise<Session | null> | null = null;
  #listeners = new Set<SessionListener>();
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: AuthClientOptions) {
    this.#gateway = opts.gateway.replace(/\/$/, "");
    this.#fetch = opts.fetch ?? fetch.bind(globalThis);
    this.#refreshLeadSeconds = opts.refreshLeadSeconds ?? 60;
  }

  // ---- public API ------------------------------------------------------

  /**
   * Returns the current session. On first call, fetches from the Gateway.
   * Subsequent calls return the in-memory value without a round-trip
   * until `signOut()` or proactive refresh mutates it.
   */
  async getSession(): Promise<Session | null> {
    if (this.#loaded) return this.#session;
    if (this.#inFlight) return this.#inFlight;
    this.#inFlight = this.#fetchSessionWithRefresh()
      .then((session) => {
        this.#session = session;
        this.#loaded = true;
        this.#scheduleRefresh(session);
        this.#emit();
        return session;
      })
      .finally(() => {
        this.#inFlight = null;
      });
    return this.#inFlight;
  }

  /** Synchronous accessor — null until `getSession()` resolves once. */
  peekSession(): Session | null {
    return this.#session;
  }

  isAuthenticated(): boolean {
    return this.#session !== null;
  }

  /**
   * Subscribe to session changes. Fires immediately with the current
   * value (synchronously — may be null if `getSession()` hasn't run yet;
   * callers that want the awaited value should `await getSession()` first).
   */
  subscribe(listener: SessionListener): Unsubscribe {
    this.#listeners.add(listener);
    listener(this.#session);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Redirect the browser to the Gateway's /login page. */
  redirectToLogin(opts?: { redirect?: string }): void {
    const url = new URL("/login", this.#gateway);
    if (opts?.redirect) url.searchParams.set("redirect_uri", opts.redirect);
    window.location.assign(url.toString());
  }

  async signOut(): Promise<void> {
    try {
      await this.#fetch(`${this.#gateway}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network errors — cookie clearing is the important bit,
      // and the Gateway sets Max-Age=0 headers on logout which run
      // before the response body is parsed.
    }
    this.#clear();
  }

  /**
   * Force a refresh now (ignore the schedule). Public because some
   * apps want to re-validate after, e.g., navigating back from a
   * hidden tab. Noop when not signed in.
   */
  async refresh(): Promise<Session | null> {
    if (!this.#session) return null;
    const refreshed = await this.#hitRefresh();
    if (!refreshed) {
      this.#clear();
      return null;
    }
    const session = await this.#fetchSession();
    this.#session = session;
    this.#scheduleRefresh(session);
    this.#emit();
    return session;
  }

  // ---- internals -------------------------------------------------------

  async #fetchSessionWithRefresh(): Promise<Session | null> {
    const first = await this.#fetchSession();
    if (first) return first;

    const refreshed = await this.#hitRefresh();
    if (!refreshed) return null;

    return this.#fetchSession();
  }

  async #fetchSession(): Promise<Session | null> {
    const res = await this.#fetch(`${this.#gateway}/auth/session`, {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SessionResponse;
    return { user: body.user, expiresAt: body.expiresAt };
  }

  async #hitRefresh(): Promise<boolean> {
    const res = await this.#fetch(`${this.#gateway}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  }

  #scheduleRefresh(session: Session | null): void {
    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    if (!session) return;
    const now = Math.floor(Date.now() / 1000);
    const secondsUntilRefresh = session.expiresAt - now - this.#refreshLeadSeconds;
    if (secondsUntilRefresh <= 0) {
      // Token is already within the refresh window — refresh right away.
      queueMicrotask(() => {
        void this.refresh();
      });
      return;
    }
    this.#refreshTimer = setTimeout(() => {
      void this.refresh();
    }, secondsUntilRefresh * 1000);
  }

  #clear(): void {
    this.#session = null;
    this.#loaded = true;
    if (this.#refreshTimer !== null) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      try {
        listener(this.#session);
      } catch (err) {
        // Listeners shouldn't throw; if they do, log + keep going so
        // one bad subscriber doesn't prevent others from being notified.
        console.error("[auth] subscriber threw:", err);
      }
    }
  }
}

/**
 * Factory function. Preferred over `new AuthClient(...)` because it's
 * the shape the documentation promises — makes ergonomics of
 * `const auth = createAuthClient({ gateway })` feel framework-agnostic.
 */
export function createAuthClient(opts: AuthClientOptions): AuthClient {
  return new AuthClient(opts);
}
