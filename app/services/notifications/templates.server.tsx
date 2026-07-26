import { render } from "@react-email/render";
import { ReviewRequestEmail, type ReviewRequestEmailProps } from "./emails/ReviewRequestEmail";
import { ReviewHeldEmail, type ReviewHeldEmailProps } from "./emails/ReviewHeldEmail";

export type ReviewRequestEmailData = ReviewRequestEmailProps;
export type ReviewHeldEmailData = ReviewHeldEmailProps;

// Renders the React Email template (emails/ReviewRequestEmail.tsx) to the plain
// {subject, html, text} shape EmailProvider.sendEmail expects — callers (review-request.server.ts,
// testEmail.server.ts) never import React Email or the component directly, so swapping the
// template's implementation never touches them.
export async function buildReviewRequestEmail(data: ReviewRequestEmailData): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const subject = `How was your ${data.productName}?`;
  const element = <ReviewRequestEmail {...data} />;

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
