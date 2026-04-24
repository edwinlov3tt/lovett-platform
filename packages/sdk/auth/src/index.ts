/**
 * @package @lovett/auth
 * @file src/index.ts
 *
 * Core (framework-agnostic) SDK entry point. React users import from
 * `@lovett/auth/react` in addition to this — the two bundles don't
 * need to be co-imported.
 */

export { AuthClient, createAuthClient } from "./client.js";
export type { AuthClientOptions, Session, SessionListener, Unsubscribe } from "./client.js";
export type { PublicUser } from "@lovett/auth-types";
