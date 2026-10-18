import { render } from "@react-email/render";
import { ReviewRequestEmail } from "./emails/ReviewRequestEmail";
import { ReviewHeldEmail, type ReviewHeldEmailProps } from "./emails/ReviewHeldEmail";
import { NewReviewEmail, type NewReviewEmailProps } from "./emails/NewReviewEmail";
import { SupportRequestEmail, type SupportRequestEmailProps } from "./emails/SupportRequestEmail";
import {
  firstNameOf,
  getDefaultEmailTemplateContent,
  normalizeEmailTemplateContent,
  renderTemplateVariables,
  stripUnresolvedVariables,
  type EmailTemplateContent,
} from "../email.shared";
import { sanitizeEmailHtml } from "../emailSanitize.server";
import { resolveEmailLogo, type SharedEmailBranding } from "../emailBranding.shared";

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
  // The store's shared Email Branding (Store.emailLogoUrl/emailLogoDarkUrl). Every caller
  // that renders a real customer email passes this; omitting it simply means the template
  // has no shared logo to inherit, which is the correct result for a store that has not set
  // one. Resolution itself lives in emailBranding.shared.ts so the preview and the real send
  // cannot diverge.
  branding?: SharedEmailBranding | null;
  // Omitted by the Email Studio preview/test-email paths (sample data, no real recipient to
  // unsubscribe) — the footer link only renders when this is present. Real sends
  // (dispatchRequestEmail/dispatchReminderEmail in review-request.server.ts) always pass one.
  unsubscribeUrl?: string;
  // "reward" template sends only — the real, already-issued Shopify discount code (see
  // rewards.server.ts). Never set for any other template type.
  discountCode?: string;
  // The purchased product's image, when the send actually has one. Optional because not
  // every product has an image and not every caller resolves one — the product block is
  // skipped rather than rendering a placeholder, so nothing here is ever invented.
  productImageUrl?: string | null;
}

export type ReviewHeldEmailData = ReviewHeldEmailProps;

export type NewReviewEmailData = NewReviewEmailProps;

export type SupportRequestEmailData = SupportRequestEmailProps;

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
  // normalizeEmailTemplateContent runs on READ as well as save: a row persisted before a
  // field existed (or before it was clamped) still has to render, and this is the last point
  // before markup where an out-of-range width or an unknown enum can be corrected.
  const content = normalizeEmailTemplateContent(data.template ?? getDefaultEmailTemplateContent());
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

  // Substituted, then swept for anything still unresolved. The sweep should never have work
  // to do — unknown tokens are rejected at the save boundary — but a reward send that somehow
  // arrives without its discount code would otherwise put the literal characters
  // "{{discount_code}}" in front of a customer. Warned about rather than silently swallowed,
  // so the underlying omission is findable in logs.
  const resolve = (text: string) => {
    const substituted = renderTemplateVariables(text, variables);
    const swept = stripUnresolvedVariables(substituted);
    if (swept !== substituted) {
      console.warn("[templates.server] stripped an unresolved variable from an outgoing email");
    }
    return swept;
  };

  const subject = resolve(content.subject);
  const heading = resolve(content.heading);
  const bodyText = data.customMessage || resolve(content.bodyText);
  const closingText = resolve(content.closingText);
  // Falls back to the subject, which is what this app showed as the inbox snippet before
  // previewText was a separate field.
  const previewText = resolve(content.previewText).trim() || subject;
  // Sanitized again here, not just on save. Persisted data is not trusted simply because it
  // is persisted — a row written by an older build (or straight into the database) must not
  // be able to ship script into a customer's inbox or into the admin preview iframe.
  const customHtml = content.customHtmlEnabled ? sanitizeEmailHtml(resolve(content.customHtml)) : null;

  // One resolution, shared by the preview and the real send.
  const resolvedLogo = resolveEmailLogo(content, data.branding ?? null);

  const element = (
    <ReviewRequestEmail
      previewText={previewText}
      heading={heading}
      bodyText={bodyText}
      closingText={closingText}
      buttonText={content.buttonText}
      accentColor={content.accentColor}
      buttonTextColor={content.buttonTextColor}
      theme={content.theme}
      fontFamily={content.fontFamily}
      headingSize={content.headingSize}
      bodySize={content.bodySize}
      density={content.density}
      contentWidth={content.contentWidth}
      cornerRadius={content.cornerRadius}
      buttonStyle={content.buttonStyle}
      buttonAlign={content.buttonAlign}
      logoUrl={resolvedLogo.logoUrl}
      logoDarkUrl={resolvedLogo.logoDarkUrl}
      logoWidth={content.logoWidth}
      storeName={effectiveStoreName}
      showStoreName={content.showStoreName}
      showPoweredBy={content.showPoweredBy}
      productName={content.showProduct ? data.productName : null}
      productImageUrl={content.showProduct ? data.productImageUrl ?? null : null}
      sections={content.sections}
      customHtml={customHtml}
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

// Mirrors buildReviewHeldEmail — the only caller is reviewNotifications.server.ts's
// sendNewReviewNotification, which never imports React Email directly. The subject line names
// the real rating and the real product (falling back to the reviewer when a review somehow has
// no product name recorded), so a merchant scanning an inbox can triage without opening
// anything — never a generic "You have a new review" for every send.
export async function buildNewReviewEmail(data: NewReviewEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = data.productName
    ? `New ${data.rating}-star review on ${data.productName}`
    : `New ${data.rating}-star review from ${data.reviewerName}`;
  const element = <NewReviewEmail {...data} />;

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}

// Mirrors buildReviewHeldEmail — the only caller is supportRequest.server.ts, which never
// imports React Email directly. The "[IMAGYN Support]" prefix is fixed here rather than being
// part of the merchant's own subject, so a merchant can neither spoof nor strip it.
export async function buildSupportRequestEmail(data: SupportRequestEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = `[IMAGYN Support] ${data.subject}`;
  const element = <SupportRequestEmail {...data} />;

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { subject, html, text };
}
