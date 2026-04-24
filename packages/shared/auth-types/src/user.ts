/**
 * @package @lovett/auth-types
 * @file src/user.ts
 *
 * User entity + runtime schema. Shared between identity-svc (the writer)
 * and everywhere else (readers, SDK consumers). Keep this minimal — PRD
 * §3 explicitly excludes profile fields beyond email + name for MVP.
 */

import { z } from "zod";

export const userStatus = z.enum(["active", "suspended", "deleted"]);
export type UserStatus = z.infer<typeof userStatus>;

export const userRole = z.enum(["user", "admin"]);
export type UserRole = z.infer<typeof userRole>;

export const user = z.object({
  id: z.string(),
  email: z.string().email(),
  emailVerifiedAt: z.number().int().nullable(),
  name: z.string().nullable(),
  orgId: z.string(),
  role: userRole,
  status: userStatus,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastLoginAt: z.number().int().nullable(),
});
export type User = z.infer<typeof user>;

/**
 * Slim public projection of a user returned to SDK consumers + browser
 * clients. Drops audit fields (createdAt, status, etc.) that external
 * callers shouldn't read. Gateway's `/auth/me` + `/auth/session` return
 * this shape.
 */
export const publicUser = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  orgId: z.string(),
  role: userRole,
});
export type PublicUser = z.infer<typeof publicUser>;
