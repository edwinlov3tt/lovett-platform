/**
 * @package @lovett/auth-gateway
 * @file src/lib/email/factory.ts
 *
 * Single entry point that builds the right EmailSender for the current
 * environment. Keeps the provider choice (and the per-env Noop fallback
 * for local dev) in one place so routes can stay dumb.
 *
 * Tests that need to assert sender invocations bypass this and set
 * `Env._testEmailSender` directly via `makeEnv({ _testEmailSender: stub })`.
 */

import type { Env } from "../../env.js";
import { EmailitSender } from "./emailit.js";
import { NoopEmailSender } from "./noop.js";
import type { EmailSender } from "./sender.js";

const DEFAULT_EMAILIT_BASE = "https://api.emailit.com/v2";

export function buildEmailSender(env: Env): EmailSender {
  if (env._testEmailSender) return env._testEmailSender;
  if (!env.EMAILIT_API_KEY) return new NoopEmailSender();
  return new EmailitSender(
    env.EMAILIT_API_KEY,
    env.EMAILIT_API_BASE_URL ?? DEFAULT_EMAILIT_BASE,
    env.MAGIC_LINK_FROM_ADDRESS,
    env.PLATFORM_NAME,
  );
}
