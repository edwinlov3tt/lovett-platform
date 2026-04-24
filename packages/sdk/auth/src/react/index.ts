/**
 * @package @lovett/auth/react
 * @file src/react/index.ts
 *
 * Barrel for the React subpath. Importing from `@lovett/auth/react`
 * pulls in React via the peer dep; importing only from `@lovett/auth`
 * doesn't, because bundlers tree-shake this subpath out entirely.
 */

export { AuthProvider, useAuthClient } from "./context.js";
export type { AuthProviderProps } from "./context.js";
export { useSession, useUser } from "./hooks.js";
export type { UseSession } from "./hooks.js";
