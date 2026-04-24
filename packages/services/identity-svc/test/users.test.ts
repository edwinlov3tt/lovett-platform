/**
 * @package @lovett/identity-svc
 * @file test/users.test.ts
 *
 * Unit tests for UserRepo — the DB-facing helper that powers
 * `findOrCreateUser` / `getUser` / `getUserByEmail`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { UserRepo } from "../src/lib/users.js";
import { getTestEnv, resetDb } from "./setup.js";

beforeEach(resetDb);

describe("UserRepo", () => {
  it("creates a user when the email isn't already registered", async () => {
    const repo = new UserRepo(getTestEnv().DB);
    const user = await repo.findOrCreate({ email: "Ed@example.com", name: "Edwin" });

    expect(user.id).toMatch(/^user_/);
    expect(user.email).toBe("ed@example.com");      // lowercased
    expect(user.name).toBe("Edwin");
    expect(user.orgId).toBe("default");
    expect(user.role).toBe("user");
    expect(user.status).toBe("active");
    expect(user.emailVerifiedAt).toBeGreaterThan(0);
  });

  it("returns the existing user on a second findOrCreate for the same email", async () => {
    const repo = new UserRepo(getTestEnv().DB);
    const a = await repo.findOrCreate({ email: "ada@example.com" });
    const b = await repo.findOrCreate({ email: "ADA@example.com" });
    expect(b.id).toBe(a.id);
  });

  it("findByEmail is case-insensitive and returns null for unknown email", async () => {
    const repo = new UserRepo(getTestEnv().DB);
    const created = await repo.findOrCreate({ email: "alice@example.com" });
    expect(await repo.findByEmail("ALICE@example.com")).not.toBeNull();
    expect(await repo.findByEmail("nobody@example.com")).toBeNull();
    expect(created.email).toBe("alice@example.com");
  });

  it("findById returns null for a nonexistent id", async () => {
    const repo = new UserRepo(getTestEnv().DB);
    expect(await repo.findById("user_does_not_exist")).toBeNull();
  });
});
