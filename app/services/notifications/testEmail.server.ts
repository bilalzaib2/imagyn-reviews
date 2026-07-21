import { getEmailProvider } from "./provider.server";
import { buildReviewRequestEmail } from "./templates.server";

// Sends a real review-request email using sample data, so a merchant can verify Resend is
// configured correctly (API key, verified sender) before any real customer ever receives one.
// Reuses the exact same template + provider path dispatchRequestEmail uses in
// review-request.server.ts — this is a manual trigger of the identical send, not a parallel
// implementation.
export async function sendTestReviewRequestEmail(to: string, storeName: string): Promise<{ id: string }> {
  const { subject, html, text } = await buildReviewRequestEmail({
    customerName: "there",
    productName: "Sample Product",
    storeName,
    reviewUrl: "https://example.com/r/sample-token",
    customMessage: "This is a test email — this is exactly what your customers will see.",
  });

  return getEmailProvider().sendEmail({ to, subject, html, text });
}
