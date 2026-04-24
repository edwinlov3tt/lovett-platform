/**
 * @package @lovett/auth/react
 * @file src/react/context.ts
 *
 * React Context + Provider. The value is the `AuthClient` instance;
 * hooks read the client from context so tools can compose:
 *
 *   const auth = createAuthClient({ gateway });
 *   <AuthProvider client={auth}>…</AuthProvider>
 */

import { createContext, createElement, useContext, type ReactNode } from "react";
import type { AuthClient } from "../client.js";

const AuthClientContext = createContext<AuthClient | null>(null);

export interface AuthProviderProps {
  client: AuthClient;
  children?: ReactNode;
}

export function AuthProvider(props: AuthProviderProps): ReactNode {
  return createElement(
    AuthClientContext.Provider,
    { value: props.client },
    props.children ?? null,
  );
}

export function useAuthClient(): AuthClient {
  const ctx = useContext(AuthClientContext);
  if (!ctx) {
    throw new Error(
      "useAuthClient: AuthProvider is missing in the tree. Wrap your app with <AuthProvider client={…}>.",
    );
  }
  return ctx;
}
