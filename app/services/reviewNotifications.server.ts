import prisma from "../db.server";
import { ReviewStatus } from "@prisma/client";
import { getEmailProvider } from "./notifications/provider.server";
import { buildNewReviewEmail } from "./notifications/templates.server";

// Merchant-facing notification for every NEW customer-submitted review.
//
// Deliberately its own service rather than another function inside moderationRules.server.ts:
// that file owns "should this review be auto-published or held," and its
// sendHeldReviewNotification exists purely as the tail of that decision. This notification has
// nothing to do with moderation — it fires for every real customer submission, including ones
// Moderation Rules published automatically, and stays useful for a store that never turns
// Moderation Rules on at all.
//
// What deliberately does NOT trigger it: imported reviews (a Judge.me/CSV migration would
// otherwise send hundreds of emails in one batch — see reviewImportExport.server.ts) and
// merchant-authored reviews created from the admin (app.reviews_.new.tsx — the merchant just
// typed it). Both call createReview directly and simply never call this function; there is no
// flag to keep in sync.

/** How a review actually reached the store. Both values correspond to a real, distinct
 *  submission route in this app — never inferred, never guessed. */
export type NewReviewSource = "storefront" | "review_request";

const SOURCE_LABELS: Record<NewReviewSource, string> = {
  storefront: "Submitted from your storefront",
  review_request: "Submitted from a review request email",
};

export interface NewReviewNotificationSettings {
  enabled: boolean;
  email: string | null;
}

// Reads the two Store columns this feature owns. Separate from moderationRules.server.ts's
// getModerationSettings on purpose — the two settings are independent, and a merchant can have
// either, both, or neither on, pointing at different inboxes.
export async function getNewReviewNotificationSettings(storeId: string): Promise<NewReviewNotificationSettings> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { newReviewNotifyEnabled: true, newReviewNotifyEmail: true },
  });

  return {
    enabled: store?.newReviewNotifyEnabled ?? false,
    email: store?.newReviewNotifyEmail ?? null,
  };
}

// Deep links into the admin. Both point at the same real screen (app.reviews.tsx) — the only
// place a merchant can read or reply to a review — with the target review preselected;
// `reply=1` additionally opens that review's reply editor. Nothing else in the app constructs
// these, so the two exported helpers below are the single source of truth for the shape, and
// app.reviews.tsx's own loader/UI is written against exactly these two parameter names.
const REVIEW_QUERY_PARAM = "review";
const REPLY_QUERY_PARAM = "reply";

function appBaseUrl(): string {
  // eslint-disable-next-line no-undef
  return (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
}

export function buildReviewAdminUrl(reviewId: string): string {
  return `${appBaseUrl()}/app/reviews?${REVIEW_QUERY_PARAM}=${encodeURIComponent(reviewId)}`;
}

export function buildReviewReplyUrl(reviewId: string): string {
  return `${buildReviewAdminUrl(reviewId)}&${REPLY_QUERY_PARAM}=1`;
}

// UTC, explicitly labelled. The app stores no merchant timezone, so rendering a local-looking
// time would be a guess — an explicit "UTC" is honest and unambiguous.
function formatSubmittedAt(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

// The merchant's "do I need to act on this" signal, derived entirely from the review's own
// real columns. moderationStatus records how the review got its FIRST status and is never
// rewritten afterwards (see Review.moderationStatus in schema.prisma), which is exactly right
// here: this email is sent once, at submission time.
function statusLabelFor(review: { status: ReviewStatus; isPublished: boolean; moderationStatus: string | null }): string {
  if (review.moderationStatus === "held") {
    return "Held for moderation by your Moderation Rules.";
  }
  if (review.status === ReviewStatus.APPROVED && review.isPublished) {
    return "Published automatically.";
  }
  return "Waiting for your approval.";
}

export interface SendNewReviewNotificationParams {
  storeId: string;
  reviewId: string;
  source: NewReviewSource;
  /** The recipient a held-review notification was just sent to for this same review, if any.
   *  When it matches this notification's own recipient, the send is skipped so one submission
   *  never produces two merchant emails in the same inbox. A different address still gets its
   *  own copy — the two settings are independent and may genuinely be two different people. */
  heldNotificationSentTo?: string | null;
}

// Fire-and-forget from the calling route (same convention as
// moderationRules.server.ts's sendHeldReviewNotification): a notification failure must never
// affect a review submission that has already succeeded, so every failure is caught and logged
// here rather than propagated.
//
// Tenant isolation: the review is loaded by (id, storeId) together, so a reviewId belonging to
// another store resolves to nothing and sends nothing — it can never be used to pull one
// store's review content into another store's inbox. The recipient likewise always comes from
// the owning store's own row, never from a caller-supplied address.
export async function sendNewReviewNotification(params: SendNewReviewNotificationParams): Promise<void> {
  try {
    const review = await prisma.review.findFirst({
      where: { id: params.reviewId, storeId: params.storeId, deletedAt: null },
      select: {
        id: true,
        rating: true,
        title: true,
        content: true,
        reviewerName: true,
        verifiedPurchase: true,
        status: true,
        isPublished: true,
        moderationStatus: true,
        productTitle: true,
        createdAt: true,
        product: { select: { name: true } },
        store: {
          select: { name: true, newReviewNotifyEnabled: true, newReviewNotifyEmail: true },
        },
      },
    });

    if (!review) {
      return;
    }

    const notifyEmail = review.store.newReviewNotifyEmail?.trim() || null;

    if (!review.store.newReviewNotifyEnabled || !notifyEmail) {
      return;
    }

    if (
      params.heldNotificationSentTo &&
      params.heldNotificationSentTo.trim().toLowerCase() === notifyEmail.toLowerCase()
    ) {
      return;
    }

    const { subject, html, text } = await buildNewReviewEmail({
      storeName: review.store.name,
      reviewerName: review.reviewerName,
      rating: review.rating,
      // Null stays null — a review with no title renders without one rather than borrowing
      // the body or the product name as a stand-in.
      title: review.title,
      content: review.content,
      // productTitle is the name captured on the review at creation time; product.name is the
      // live catalog name. Either is real; the live name is preferred because that's what the
      // merchant sees everywhere else in the admin.
      productName: review.product?.name || review.productTitle || null,
      submittedAt: formatSubmittedAt(review.createdAt),
      verifiedPurchase: review.verifiedPurchase,
      source: SOURCE_LABELS[params.source] ?? null,
      statusLabel: statusLabelFor(review),
      viewUrl: buildReviewAdminUrl(review.id),
      replyUrl: buildReviewReplyUrl(review.id),
    });

    await getEmailProvider().sendEmail({ to: notifyEmail, subject, html, text });
  } catch (error) {
    console.error("Failed to send new-review notification email:", error);
  }
}
