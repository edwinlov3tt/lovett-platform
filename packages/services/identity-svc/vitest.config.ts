/**
 * @package @lovett/identity-svc
 * @file vitest.config.ts
 *
 * Uses @cloudflare/vitest-pool-workers so tests run inside a real
 * workerd isolate with D1 bindings wired up via miniflare. That way
 * Drizzle + our RPC methods exercise the actual Cloudflare runtime,
 * not a Node polyfill.
 */

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        // `isolatedStorage: false` disables vitest-pool-workers' per-test
        // D1/KV checkpoint+rollback. Our tests call `resetDb()` in
        // `beforeEach` which is more explicit + sidesteps a known
        // miniflare cleanup assertion failure on D1's sqlite-shm files.
        isolatedStorage: false,
      },
    },
  },
});
