import { NotificationProviderError, type EmailProvider } from "./types";
import { createResendEmailProvider } from "./resend.server";

// The single place that reads EMAIL_PROVIDER — switching vendors is a config change here,
// never a change to review-request.server.ts (the only caller) or any UI code. Mirrors
// app/services/ai/provider.server.ts's getAiProvider().
export function getEmailProvider(): EmailProvider {
  const configured = (process.env.EMAIL_PROVIDER || "resend").trim().toLowerCase();

  switch (configured) {
    case "resend":
      return createResendEmailProvider();
    default:
      throw new NotificationProviderError(
        `Unknown EMAIL_PROVIDER "${configured}". Expected "resend".`,
        configured,
      );
  }
}
