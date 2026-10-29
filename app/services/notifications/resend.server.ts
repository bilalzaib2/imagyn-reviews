import { Resend } from "resend";
import {
  NotificationProviderError,
  type EmailProvider,
  type EmailSendRequest,
  type EmailSendResult,
} from "./types";

// RESEND_FROM_EMAIL may already be configured as either a bare address or a
// "Display Name <address>" pair — this extracts just the address so a per-send fromName
// (see below) always wins over whatever static display name happens to be configured.
function extractAddress(fromEnv: string): string {
  const match = fromEnv.match(/<([^>]+)>/);
  return (match ? match[1] : fromEnv).trim();
}

// Header-value sanitization, not content escaping — strips characters that could otherwise
// inject a second header (CRLF) or break the "Name <email>" quoting Resend expects. This is
// merchant-controlled data (a store's own name), not attacker input, but a From header is a
// deliberately narrow place to still be defensive about.
function sanitizeDisplayName(name: string): string {
  return name.replace(/[\r\n"<>]/g, "").trim();
}

export function createResendEmailProvider(): EmailProvider {
  return {
    name: "resend",
    async sendEmail(request: EmailSendRequest): Promise<EmailSendResult> {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new NotificationProviderError(
          "RESEND_API_KEY is not configured. Set it in the environment to send review request emails.",
          "resend",
        );
      }

      const fromEnv = process.env.RESEND_FROM_EMAIL;
      if (!fromEnv) {
        throw new NotificationProviderError(
          "RESEND_FROM_EMAIL is not configured. Set it in the environment to send review request emails.",
          "resend",
        );
      }

      // A customer-facing send gets the merchant's own store name as the display name AND a
      // merchant-scoped local part on the platform's verified domain — e.g.
      // "Coastal Threads <requests+coastal.myshopify.com@notifications.imagyn.co>" — so both
      // halves of the From header identify the store rather than Imagyn. The domain is never
      // merchant-supplied, so DKIM still signs d=<platform domain>; see
      // emailSenderIdentity.shared.ts for why that is the line between scoped and spoofed.
      // Imagyn's own merchant-facing notifications (fromName omitted) keep whatever display
      // name RESEND_FROM_EMAIL itself already carries.
      //
      // Validated here as well as at construction: this is the last point before a mail header.
      // Exactly one "@" is permitted and no delimiter or whitespace, so a value like
      // "a@b@x.test" or "x@y.test>, evil@attacker.com" can never forge a second address.
      const resolvedAddress = request.fromAddress?.trim();
      const safeAddress =
        resolvedAddress && /^[^\s<>,;"@]+@[^\s<>,;"@]+$/.test(resolvedAddress)
          ? resolvedAddress
          : extractAddress(fromEnv);

      const sanitizedName = request.fromName ? sanitizeDisplayName(request.fromName) : "";
      const from = sanitizedName ? `${sanitizedName} <${safeAddress}>` : fromEnv;

      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send(
        {
          from,
          to: request.to,
          subject: request.subject,
          html: request.html,
          text: request.text,
          ...(request.replyTo ? { replyTo: request.replyTo } : {}),
          // Echoed back verbatim on every delivery webhook event (see webhooks.resend.tsx) —
          // this is how that endpoint correlates an event back to a ReviewRequest without a
          // separate stored-message-id column.
          ...(request.tags
            ? { tags: Object.entries(request.tags).map(([name, value]) => ({ name, value })) }
            : {}),
        },
        // Second argument, not part of the payload: Resend sends this as the `Idempotency-Key`
        // header, and a repeat with the same key returns the original response WITHOUT sending
        // again (keys retained 24h). This is what makes the scheduler's crash-recovery retry
        // safe — see EmailSendRequest.idempotencyKey for the full reasoning. Omitted entirely
        // when the caller supplies none, so every existing send path is byte-identical.
        request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : undefined,
      );

      if (error) {
        throw new NotificationProviderError(`Resend request failed: ${error.message}`, "resend");
      }

      if (!data?.id) {
        throw new NotificationProviderError("Resend response did not include a message id.", "resend");
      }

      return { id: data.id };
    },
  };
}
