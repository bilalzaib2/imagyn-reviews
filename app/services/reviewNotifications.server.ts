import prisma from "../db.server";
import { ReviewStatus } from "@prisma/client";
import { getEmailProvider } from "./notifications/provider.server";
import { buildNewReviewEmail } from "./notifications/templates.server";
import { isHeaderSafeAddress } from "./emailSenderIdentity.shared";

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
        productId: true,
        rating: true,
        title: true,
        content: true,
        reviewerName: true,
        // Becomes the Reply-To, so the merchant's reply reaches the customer directly. Never
        // rendered into the email body — see the privacy note on replyTo below.
        reviewerEmail: true,
        verifiedPurchase: true,
        status: true,
        isPublished: true,
        moderationStatus: true,
        productTitle: true,
        createdAt: true,
        product: { select: { name: true } },
        store: {
          select: {
            name: true,
            newReviewNotifyEnabled: true,
            newReviewNotifyEmail: true,
            // Shopify's own customer-facing contact address, synced by
            // shopContactEmail.server.ts. Used as the notification recipient when the merchant
            // has not nominated a different inbox, so a store that never opened the setting
            // still reaches a real, Shopify-designated mailbox.
            contactEmail: true,
          },
        },
      },
    });

    if (!review) {
      return;
    }

    // RECIPIENT. The merchant's explicitly nominated inbox wins — that is a deliberate
    // preference and must not be second-guessed. When they never set one, fall back to
    // Shopify's own customer-facing contact address (synced by shopContactEmail.server.ts),
    // which is the mailbox Shopify designates for exactly this purpose. Both are re-validated
    // here, because this is the value that actually becomes a To header.
    const preferredNotifyEmail = review.store.newReviewNotifyEmail?.trim() || null;
    const contactNotifyEmail = review.store.contactEmail?.trim() || null;
    const notifyEmail =
      (isHeaderSafeAddress(preferredNotifyEmail) ? preferredNotifyEmail : null) ??
      (isHeaderSafeAddress(contactNotifyEmail) ? contactNotifyEmail : null);

    if (!review.store.newReviewNotifyEnabled || !notifyEmail) {
      return;
    }

    if (
      params.heldNotificationSentTo &&
      params.heldNotificationSentTo.trim().toLowerCase() === notifyEmail.toLowerCase()
    ) {
      return;
    }

    // REPLY-TO: the reviewer's own address, so the merchant hitting Reply in their mail client
    // reaches the customer directly rather than Imagyn. This is the whole point of the header.
    //
    // Validated through the same isHeaderSafeAddress the sender-identity resolver uses, not a
    // looser check: a single address, exactly one "@", and no whitespace, quote, comma,
    // semicolon or angle bracket, so a reviewer-supplied value can never terminate the header
    // and append a second recipient. A review whose email is missing, malformed, or redacted by
    // the GDPR webhook simply gets no Reply-To, and the merchant still receives the
    // notification with its working View and Reply buttons into the admin.
    //
    // PRIVACY: this address is a header on an email going to the store that owns the review,
    // and nowhere else. It is never rendered into the body, never returned to a storefront
    // response, and cannot cross stores — the review was loaded by (id, storeId) together, so
    // another merchant's review resolves to nothing above.
    const reviewerEmail = review.reviewerEmail?.trim() || null;
    const replyToReviewer = isHeaderSafeAddress(reviewerEmail) ? reviewerEmail : null;

    // ORDER CONTEXT, only where it genuinely exists. There is no orderNumber on Review, so it
    // is resolved from the ReviewRequest this review answers, matched on the same
    // (storeId, productId, email) triple getExistingRequestContext already treats as one
    // customer-and-product pair. Scoped to this store, newest first. A storefront review with
    // no originating request has no order number and renders none — never an invented one.
    let orderNumber: string | null = null;
    if (reviewerEmail) {
      const originatingRequest = await prisma.reviewRequest.findFirst({
        where: {
          storeId: params.storeId,
          productId: review.productId,
          email: reviewerEmail,
          orderNumber: { not: null },
        },
        select: { orderNumber: true },
        orderBy: { createdAt: "desc" },
      });
      orderNumber = originatingRequest?.orderNumber?.trim() || null;
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
      orderNumber,
      replyToReviewer: replyToReviewer !== null,
      viewUrl: buildReviewAdminUrl(review.id),
      replyUrl: buildReviewReplyUrl(review.id),
    });

    await getEmailProvider().sendEmail({
      to: notifyEmail,
      subject,
      html,
      text,
      // Omitted entirely rather than set to a placeholder when the reviewer has no usable
      // address — a Reply-To pointing at Imagyn would actively mislead the merchant into
      // thinking they had replied to their customer.
      ...(replyToReviewer ? { replyTo: replyToReviewer } : {}),
    });
  } catch (error) {
    console.error("Failed to send new-review notification email:", error);
  }
}
