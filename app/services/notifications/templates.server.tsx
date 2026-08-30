import { render } from "@react-email/render";
import { ReviewRequestEmail } from "./emails/ReviewRequestEmail";
import { ReviewHeldEmail, type ReviewHeldEmailProps } from "./emails/ReviewHeldEmail";
import {
  firstNameOf,
  getDefaultEmailTemplateContent,
  renderTemplateVariables,
  type EmailTemplateContent,
} from "../email.shared";

export interface ReviewRequestEmailData {
  customerName: string;
  productName: string;
  storeName: string;
  // For a "reward" template send, this is the store's own storefront URL, not a review link
  // — reused rather than adding a second near-identical CTA-button prop to
  // ReviewRequestEmail.tsx, since the component only ever renders "a button + a copy-paste
  // fallback link," which is equally correct for either destination.
  reviewUrl: string;
  // Per-request override (set on an individual review request, not the template) — takes
  // priority over the template's own default body text, same precedence this had before Email
  // Studio existed.
  customMessage: string | null;
  // The store's saved Email Studio content — omitted (or not yet configured) falls back to
  // getDefaultEmailTemplateContent(), which reproduces this template's original hardcoded
  // copy/colors exactly, so an unconfigured store's emails are unaffected by this feature.
  template?: EmailTemplateContent;
  // Omitted by the Email Studio preview/test-email paths (sample data, no real recipient to
  // unsubscribe) — the footer link only renders when this is present. Real sends
  // (dispatchRequestEmail/dispatchReminderEmail in review-request.server.ts) always pass one.
  unsubscribeUrl?: string;
  // "reward" template sends only — the real, already-issued Shopify discount code (see
  // rewards.server.ts). Never set for any other template type.
  discountCode?: string;
}

export type ReviewHeldEmailData = ReviewHeldEmailProps;

// Renders the React Email template (emails/ReviewRequestEmail.tsx) to the plain
// {subject, html, text} shape EmailProvider.sendEmail expects — callers (review-request.server.ts,
// testEmail.server.ts) never import React Email or the component directly, so swapping the
// template's implementation never touches them. This is also the one place that resolves a
// merchant's EmailTemplateContent + this send's customer/store/product data into final,
// variable-substituted strings — the component itself only renders.
export async function buildReviewRequestEmail(data: ReviewRequestEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const content = data.template ?? getDefaultEmailTemplateContent();
  // A merchant's displayName override affects only what's shown inside the email (this
  // variable and the eyebrow line below) — the actual From address always uses the real
  // store name regardless (see resend.server.ts's fromName), so sender identity stays
  // accurate even if a merchant shows a friendlier name in the copy.
  const effectiveStoreName = content.displayName?.trim() || data.storeName;
  const variables = {
    customerName: firstNameOf(data.customerName),
    storeName: effectiveStoreName,
    productName: data.productName,
    discountCode: data.discountCode,
  };

  const subject = renderTemplateVariables(content.subject, variables);
  const heading = renderTemplateVariables(content.heading, variables);
  const bodyText = data.customMessage || renderTemplateVariables(content.bodyText, variables);

  const element = (
    <ReviewRequestEmail
      previewText={subject}
      heading={heading}
      bodyText={bodyText}
      buttonText={content.buttonText}
      accentColor={content.accentColor}
      logoUrl={content.logoUrl}
      storeName={effectiveStoreName}
      showStoreName={content.showStoreName}
      showPoweredBy={content.showPoweredBy}
      reviewUrl={data.reviewUrl}
      unsubscribeUrl={data.unsubscribeUrl}
    />
  );

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}

// Mirrors buildReviewRequestEmail — the only caller is moderationRules.server.ts's
// sendHeldReviewNotification, which never imports React Email directly.
export async function buildReviewHeldEmail(data: ReviewHeldEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = `A review was held for moderation — ${data.productName}`;
  const element = <ReviewHeldEmail {...data} />;

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}
