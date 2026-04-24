/**
 * @package @lovett/auth-gateway
 * @file vitest.config.ts
 *
 * Plain vitest (node environment). The Gateway tests inject a FakeIdentity
 * directly into the env — no real D1, no real service binding. Using the
 * @cloudflare/vitest-pool-workers would force both Workers to spin up
 * through miniflare, which is overkill for shape-level tests and breaks
 * unless identity-svc is running too.
 *
 * Routes are tested against `app.request(path, init, env)` which Hono
 * supports without any Cloudflare runtime.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
