import { NotificationProviderError, type EmailProvider } from "./types";
import { createResendEmailProvider } from "./resend.server";
import { createCaptureEmailProvider } from "./capture.server";

// The single place that reads EMAIL_PROVIDER — switching vendors is a config change here,
// never a change to review-request.server.ts (the only caller) or any UI code. Mirrors
// app/services/ai/provider.server.ts's getAiProvider().
export function getEmailProvider(): EmailProvider {
  const configured = (process.env.EMAIL_PROVIDER || "resend").trim().toLowerCase();

  switch (configured) {
    case "resend":
      return createResendEmailProvider();
    // Records sends in process instead of delivering them — see capture.server.ts. Used by the
    // accelerated review-request lifecycle harness so the real scheduling path can be exercised
    // end to end without putting a message on the wire. Unset in production, which falls
    // through to "resend" above, so this is unreachable there.
    case "capture":
      return createCaptureEmailProvider();
    default:
      throw new NotificationProviderError(
        `Unknown EMAIL_PROVIDER "${configured}". Expected "resend" or "capture".`,
        configured,
      );
  }
}
