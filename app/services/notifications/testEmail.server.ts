import { getEmailProvider } from "./provider.server";
import { buildReviewRequestEmail } from "./templates.server";
import { emailTemplateService } from "../emailTemplate.server";

// Sends a real review-request email using sample data, so a merchant can verify Resend is
// configured correctly (API key, verified sender) before any real customer ever receives one.
// Reuses the exact same template-resolution + provider path dispatchRequestEmail uses in
// review-request.server.ts — including the store's own Email Studio customization, if any —
// so this is a manual trigger of the identical send, not a parallel implementation.
export async function sendTestReviewRequestEmail(to: string, storeId: string, storeName: string): Promise<{ id: string }> {
  const template = await emailTemplateService.getActiveContent(storeId);

  const { subject, html, text } = await buildReviewRequestEmail({
    customerName: "there",
    productName: "Sample Product",
    storeName,
    reviewUrl: "https://example.com/r/sample-token",
    customMessage: "This is a test email — this is exactly what your customers will see.",
    template,
  });

  return getEmailProvider().sendEmail({
    to,
    subject,
    html,
    text,
    // Matches dispatchRequestEmail/dispatchReminderEmail's sender identity exactly, so this
    // "here's exactly what your customers will see" test send is honest about the From header
    // too, not just the body content.
    fromName: storeName,
  });
}
