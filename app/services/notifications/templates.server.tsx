import { render } from "@react-email/render";
import { ReviewRequestEmail, type ReviewRequestEmailProps } from "./emails/ReviewRequestEmail";

export type ReviewRequestEmailData = ReviewRequestEmailProps;

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
