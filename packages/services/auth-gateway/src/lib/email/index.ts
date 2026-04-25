/**
 * @package @lovett/auth-gateway
 * @file src/lib/email/index.ts
 *
 * Barrel for the email module. Consumers import the `EmailSender`
 * interface and `buildEmailSender()` factory from here — never from
 * adapter modules directly (that defeats the whole point of the seam).
 */

export { buildEmailSender } from "./factory.js";
export {
  EmailSendError,
  type EmailSender,
  type SendMagicLinkParams,
} from "./sender.js";
