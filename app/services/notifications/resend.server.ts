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

      // A customer-facing send (review requests/reminders) gets the merchant's own store name
      // as the display name — e.g. "Coastal Threads <reviews@notifications.imagyn.co>" — so it
      // reads as coming from the store, not a generic "Imagyn Reviews" identity, without
      // requiring per-merchant domain verification (see docs on canUseCustomEmailDomain for
      // the real future capability this stands in for). Imagyn's own merchant-facing
      // notifications (fromName omitted) keep whatever display name RESEND_FROM_EMAIL itself
      // already carries.
      const sanitizedName = request.fromName ? sanitizeDisplayName(request.fromName) : "";
      const from = sanitizedName ? `${sanitizedName} <${extractAddress(fromEnv)}>` : fromEnv;

      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: request.to,
        subject: request.subject,
        html: request.html,
        text: request.text,
        // Echoed back verbatim on every delivery webhook event (see webhooks.resend.tsx) —
        // this is how that endpoint correlates an event back to a ReviewRequest without a
        // separate stored-message-id column.
        ...(request.tags
          ? { tags: Object.entries(request.tags).map(([name, value]) => ({ name, value })) }
          : {}),
      });

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
