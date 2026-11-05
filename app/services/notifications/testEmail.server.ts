import { getEmailProvider } from "./provider.server";
import { buildReviewRequestEmail } from "./templates.server";
import { emailTemplateService } from "../emailTemplate.server";
import { buildRatingUrls } from "../email.shared";
import type { EmailTemplateContent, EmailTemplateType } from "../email.shared";
import type { SenderIdentity } from "../emailSenderIdentity.shared";
import type { SharedEmailBranding } from "../emailBranding.shared";

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
  /** The resolved sender identity, so a test send shows the same From name and Reply-To a
   *  real customer send would. Supplied by the caller, which already has the store and its
   *  entitlements — resolving it here would mean a database read inside the send path for a
   *  value the caller is holding. Omitted falls back to the store name, which is exactly
   *  what this function did before branded senders existed. */
  senderIdentity?: SenderIdentity;
  /** The store's shared Email Branding, so a test renders the same logo a customer gets. */
  branding?: SharedEmailBranding | null;
}

/** Sample link, never a real token: no ReviewRequest row exists for it, so following it
 *  lands on the "link not found" page rather than someone else's review form. */
const SAMPLE_REVIEW_URL = "https://example.com/r/sample-token";

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
    reviewUrl: SAMPLE_REVIEW_URL,
    // The star row renders in a test send too, so a merchant can tap one and see exactly what
    // their customer will. Omitted for "reward", whose CTA is a storefront URL with no rating
    // to carry — the same rule rewards.server.ts and the Email Studio preview both follow.
    ratingUrls: type === "reward" ? null : buildRatingUrls(SAMPLE_REVIEW_URL),
    customMessage: null,
    branding: options.branding ?? null,
    // Sample-only, matching the sample-token URL's own "never real" convention — a reward
    // template needs some code to show {{discount_code}} substituted, but this string is
    // never a real, redeemable Shopify discount.
    discountCode: type === "reward" ? "SAMPLE-CODE" : undefined,
    template,
  });

  // Resolved by the caller through the same function the real sends use, so this stays an
  // honest preview of the From header rather than drifting from it. A test send showing a
  // different sender than the real one would be worse than no test at all — it is the only
  // way a merchant can confirm their branded sender name before a customer sees it.
  const senderIdentity = options.senderIdentity;

  return getEmailProvider().sendEmail({
    to,
    // Prefixed so a test landing in a shared inbox is never mistaken for a real customer
    // send, while the body below stays byte-identical to what a customer would receive.
    subject: `[Test] ${subject}`,
    html,
    text,
    fromName: senderIdentity?.displayName ?? storeName,
    ...(senderIdentity?.fromAddress ? { fromAddress: senderIdentity.fromAddress } : {}),
    ...(senderIdentity?.replyTo ? { replyTo: senderIdentity.replyTo } : {}),
  });
}
