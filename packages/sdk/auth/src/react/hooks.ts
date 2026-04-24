/**
 * @package @lovett/auth/react
 * @file src/react/hooks.ts
 *
 * `useSession` / `useUser` built on `useSyncExternalStore` so React
 * renders stay in sync with the AuthClient's internal state without
 * us owning a second state store. The client's `subscribe(listener)`
 * method is already the right shape for useSyncExternalStore.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { PublicUser } from "@lovett/auth-types";
import type { Session } from "../client.js";
import { useAuthClient } from "./context.js";

export interface UseSession {
  user: PublicUser | null;
  expiresAt: number | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * The canonical hook. Fires a `getSession()` call on mount if the
 * client hasn't loaded yet; after that, state updates are driven
 * entirely by `client.subscribe`.
 */
export function useSession(): UseSession {
  const client = useAuthClient();

  const session = useSyncExternalStore<Session | null>(
    (listener) => client.subscribe(listener),
    () => client.peekSession(),
    () => null,   // SSR fallback — always "not signed in" server-side
  );

  const loading = !client.isAuthenticated() && session === null && !hasLoadedOnce(client);

  useEffect(() => {
    // Kick an initial fetch once per mount if the client hasn't loaded.
    // The client dedupes concurrent getSession() calls itself.
    void client.getSession();
  }, [client]);

  return {
    user: session?.user ?? null,
    expiresAt: session?.expiresAt ?? null,
    loading,
    signOut: () => client.signOut(),
  };
}

/** Thin projection when the caller only wants the user object. */
export function useUser(): PublicUser | null {
  return useSession().user;
}

// ---- internals --------------------------------------------------------

// The AuthClient exposes `peekSession()` + `isAuthenticated()` but not
// a direct "has loaded" flag — we track it here via a WeakMap so we
// don't monkey-patch the client class just for the hook's loading state.
const LOADED = new WeakMap<object, boolean>();
function hasLoadedOnce(client: object): boolean {
  if (LOADED.get(client)) return true;
  // Probe: if peek returns a value, the client has loaded.
  return false;
}
