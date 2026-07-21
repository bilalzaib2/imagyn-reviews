import { Resend } from "resend";
import {
  NotificationProviderError,
  type EmailProvider,
  type EmailSendRequest,
  type EmailSendResult,
} from "./types";

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

      const from = process.env.RESEND_FROM_EMAIL;
      if (!from) {
        throw new NotificationProviderError(
          "RESEND_FROM_EMAIL is not configured. Set it in the environment to send review request emails.",
          "resend",
        );
      }

      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: request.to,
        subject: request.subject,
        html: request.html,
        text: request.text,
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
