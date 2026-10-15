// Branded Email Sender Identity — the server-only half.
//
// Only the verified From address genuinely needs the server, because only it reads
// process.env. Everything else (the type, the length cap, the sanitiser, and the resolution
// rules) lives in emailSenderIdentity.shared.ts so Email Studio's component can import it
// without dragging server code into the client bundle.
import type { Permissions } from "./permissions";
import {
  resolveSenderIdentityWith,
  type SenderIdentity,
  type SenderIdentityStore,
} from "./emailSenderIdentity.shared";

export {
  MAX_SENDER_NAME_LENGTH,
  sanitizeSenderName,
  type SenderIdentity,
  type SenderIdentityStore,
} from "./emailSenderIdentity.shared";

/** The platform's verified From address, with any configured display name stripped off. */
export function platformFromAddress(): string | null {
  const configured = process.env.RESEND_FROM_EMAIL?.trim();
  if (!configured) return null;
  const match = configured.match(/<([^>]+)>/);
  const address = (match ? match[1] : configured).trim();
  return address.includes("@") ? address : null;
}

/** See resolveSenderIdentityWith — this supplies the real verified sending address. */
export function resolveSenderIdentity(
  store: SenderIdentityStore,
  permissions: Pick<Permissions, "canUseBrandedEmailSender">,
  replyTo: string | null = null,
): SenderIdentity {
  return resolveSenderIdentityWith(store, permissions, replyTo, platformFromAddress());
}
