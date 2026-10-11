import { getEmailProvider } from "./provider.server";
import { buildReviewRequestEmail } from "./templates.server";
import { emailTemplateService } from "../emailTemplate.server";
import type { EmailTemplateContent, EmailTemplateType } from "../email.shared";

// Sends a real email using sample data, so a merchant can verify Resend is configured
// correctly (API key, verified sender) and see exactly what a customer receives — before any
// real customer ever does. Reuses the exact same template-resolution + provider path
// dispatchRequestEmail uses in review-request.server.ts, so this is a manual trigger of the
// identical send, not a parallel implementation.
export interface TestEmailOptions {
  /** Which template to send. Defaults to the Day-0 review request. */
  type?: EmailTemplateType;
  /** An unsaved Email Studio draft. When provided it is used verbatim instead of the store's
   *  persisted template, so "Send test" tests what is on screen rather than what was last
   *  saved — which is the only version a merchant actually wants to check. Already
   *  plan-sanitized and HTML-sanitized by the caller (app.email-studio.tsx's action); the
   *  render path in templates.server.tsx sanitizes custom HTML again regardless. */
  draft?: EmailTemplateContent;
}

export async function sendTestReviewRequestEmail(
  to: string,
  storeId: string,
  storeName: string,
  options: TestEmailOptions = {},
): Promise<{ id: string }> {
  const type = options.type ?? "review_request";
  const template = options.draft ?? (await emailTemplateService.getActiveContent(storeId, type));

  const { subject, html, text } = await buildReviewRequestEmail({
    customerName: "there",
    productName: "Sample Product",
    storeName,
    reviewUrl: "https://example.com/r/sample-token",
    customMessage: null,
    // Sample-only, matching the sample-token URL's own "never real" convention — a reward
    // template needs some code to show {{discount_code}} substituted, but this string is
    // never a real, redeemable Shopify discount.
    discountCode: type === "reward" ? "SAMPLE-CODE" : undefined,
    template,
  });

  return getEmailProvider().sendEmail({
    to,
    // Prefixed so a test landing in a shared inbox is never mistaken for a real customer
    // send, while the body below stays byte-identical to what a customer would receive.
    subject: `[Test] ${subject}`,
    html,
    text,
    // Matches dispatchRequestEmail/dispatchReminderEmail's sender identity exactly, so this
    // "here's exactly what your customers will see" test send is honest about the From header
    // too, not just the body content.
    fromName: storeName,
  });
}
