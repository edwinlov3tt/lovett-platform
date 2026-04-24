/**
 * @package @lovett/identity-svc
 * @file drizzle.config.ts
 *
 * Drizzle-kit config for generating SQL migrations from `src/db/schema.ts`.
 * We emit to `migrations/` which is the same directory wrangler reads for
 * `wrangler d1 migrations apply`, so `pnpm db:generate` and then
 * `pnpm db:migrate:*` is the whole dev loop.
 */

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;
