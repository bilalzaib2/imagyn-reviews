// Exercises sendNewReviewNotification against a fake Review table and a fake email provider —
// no real database, no real email provider. The React Email template itself is rendered for
// real (it's pure), so these tests also prove the merchant actually receives the review's real
// data rather than a placeholder.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  name: string;
  newReviewNotifyEnabled: boolean;
  newReviewNotifyEmail: string | null;
  /** Shopify's own customer-facing contact address, synced by shopContactEmail.server.ts.
   *  Used as the notification recipient when the merchant nominated no inbox of their own. */
  contactEmail: string | null;
}

interface FakeReview {
  id: string;
  storeId: string;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  /** Becomes the Reply-To, so a merchant replying reaches the customer. */
  reviewerEmail: string | null;
  verifiedPurchase: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  isPublished: boolean;
  moderationStatus: string | null;
  productId: string;
  productTitle: string | null;
  productName: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

let fakeStores: Record<string, FakeStore>;
let fakeReviews: FakeReview[];
/** The ReviewRequest the notification resolves an order number from, or null for a storefront
 *  review with no originating request. */
let fakeOriginatingRequest: { orderNumber: string | null } | null;

const sendEmail = vi.fn(async () => ({ id: "fake-message-id" }));

vi.mock("./notifications/provider.server", () => ({
  getEmailProvider: () => ({ name: "fake", sendEmail }),
}));

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const store = fakeStores[args.where.id];
        if (!store) return null;
        return {
          newReviewNotifyEnabled: store.newReviewNotifyEnabled,
          newReviewNotifyEmail: store.newReviewNotifyEmail,
        };
      }),
    },
    review: {
      // Mirrors the real query's own (id, storeId, deletedAt) filter — the tenant-isolation
      // guarantee under test is that all three are part of the same lookup, so a review from
      // another store resolves to null rather than being found and then compared.
      findFirst: vi.fn(async (args: { where: { id: string; storeId: string; deletedAt: null } }) => {
        const review = fakeReviews.find(
          (row) => row.id === args.where.id && row.storeId === args.where.storeId && row.deletedAt === null,
        );
        if (!review) return null;

        const store = fakeStores[review.storeId];
        return {
          id: review.id,
          productId: review.productId,
          rating: review.rating,
          title: review.title,
          content: review.content,
          reviewerName: review.reviewerName,
          reviewerEmail: review.reviewerEmail,
          verifiedPurchase: review.verifiedPurchase,
          status: review.status,
          isPublished: review.isPublished,
          moderationStatus: review.moderationStatus,
          productTitle: review.productTitle,
          createdAt: review.createdAt,
          product: review.productName ? { name: review.productName } : null,
          store: {
            name: store.name,
            newReviewNotifyEnabled: store.newReviewNotifyEnabled,
            newReviewNotifyEmail: store.newReviewNotifyEmail,
            contactEmail: store.contactEmail,
          },
        };
      }),
    },
    reviewRequest: {
      // Backs the order-number lookup: the notification matches the ReviewRequest this review
      // answers on the same (storeId, productId, email) triple getExistingRequestContext treats
      // as one customer-and-product pair.
      findFirst: vi.fn(async () => fakeOriginatingRequest),
    },
  },
}));

const { buildReviewAdminUrl, buildReviewReplyUrl, getNewReviewNotificationSettings, sendNewReviewNotification } =
  await import("./reviewNotifications.server");

const APP_URL = "https://app.imagyn.co";

function review(overrides: Partial<FakeReview> = {}): FakeReview {
  return {
    id: "rev_1",
    storeId: "store_1",
    rating: 5,
    title: "Exactly what I wanted",
    content: "Arrived in two days and the fit is perfect.",
    reviewerName: "Dana Ruiz",
    reviewerEmail: "dana@example.com",
    verifiedPurchase: true,
    status: "APPROVED",
    isPublished: true,
    moderationStatus: "auto_approved",
    productId: "prod_1",
    productTitle: "Linen Shirt",
    productName: "Linen Shirt",
    createdAt: new Date("2026-09-20T14:30:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function lastSend(): { to: string; subject: string; html: string; text: string; replyTo?: string } {
  const calls = sendEmail.mock.calls as unknown as Array<
    [{ to: string; subject: string; html: string; text: string; replyTo?: string }]
  >;
  const last = calls[calls.length - 1];
  if (!last) {
    throw new Error("Expected sendEmail to have been called.");
  }
  return last[0];
}

beforeEach(() => {
  // eslint-disable-next-line no-undef
  process.env.SHOPIFY_APP_URL = APP_URL;
  sendEmail.mockClear();
  fakeStores = {
    store_1: {
      name: "Coastal Threads",
      newReviewNotifyEnabled: true,
      newReviewNotifyEmail: "owner@coastal.test",
      contactEmail: "hello@coastal.test",
    },
    store_2: {
      name: "Other Store",
      newReviewNotifyEnabled: true,
      newReviewNotifyEmail: "owner@other.test",
      contactEmail: "hello@other.test",
    },
  };
  fakeReviews = [review()];
  fakeOriginatingRequest = { orderNumber: "#1042" };
});

describe("recipient + enable gating", () => {
  it("sends to the store's own configured notification address", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(lastSend().to).toBe("owner@coastal.test");
  });

  it("sends nothing when the setting is off", async () => {
    fakeStores.store_1.newReviewNotifyEnabled = false;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  // CONTRACT CHANGE. This used to assert that no address meant no email. A notification
  // recipient now falls back to Shopify's own customer-facing contact address, so a merchant
  // who switched notifications ON is no longer silently given nothing. The "send nothing" case
  // still exists and is asserted below — it is now "neither address available", not "no
  // nominated address".
  it("falls back to Shopify's contact email when no address is nominated", async () => {
    fakeStores.store_1.newReviewNotifyEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().to).toBe("hello@coastal.test");
  });

  it("sends nothing when the setting is on and neither address is configured", async () => {
    fakeStores.store_1.newReviewNotifyEmail = null;
    fakeStores.store_1.contactEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only nominated address as unconfigured and falls back", async () => {
    fakeStores.store_1.newReviewNotifyEmail = "   ";

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().to).toBe("hello@coastal.test");
  });

  it("treats a whitespace-only address on BOTH fields as no recipient at all", async () => {
    fakeStores.store_1.newReviewNotifyEmail = "   ";
    fakeStores.store_1.contactEmail = "   ";

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("getNewReviewNotificationSettings reports the store's real saved values", async () => {
    await expect(getNewReviewNotificationSettings("store_1")).resolves.toEqual({
      enabled: true,
      email: "owner@coastal.test",
    });
  });

  it("getNewReviewNotificationSettings reports a disabled default for an unknown store", async () => {
    await expect(getNewReviewNotificationSettings("store_missing")).resolves.toEqual({
      enabled: false,
      email: null,
    });
  });
});

describe("tenant isolation", () => {
  it("sends nothing when the review belongs to a different store", async () => {
    // store_2 has notifications on and its own recipient — the only thing wrong here is that
    // rev_1 isn't its review. Nothing may be sent, and store_1's content must never leak.
    await sendNewReviewNotification({ storeId: "store_2", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a soft-deleted review", async () => {
    fakeReviews = [review({ deletedAt: new Date("2026-09-21T00:00:00Z") })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a review id that does not exist", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_nope", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("real review data in the email", () => {
  it("names the real rating and product in the subject", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().subject).toBe("New 5-star review on Linen Shirt");
  });

  it("falls back to the reviewer in the subject when the review has no product name at all", async () => {
    fakeReviews = [review({ productName: null, productTitle: null })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().subject).toBe("New 5-star review from Dana Ruiz");
  });

  it("includes the reviewer name, title, body, product and store name", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    const { text } = lastSend();
    expect(text).toContain("Dana Ruiz");
    expect(text).toContain("Exactly what I wanted");
    expect(text).toContain("Arrived in two days and the fit is perfect.");
    expect(text).toContain("Linen Shirt");
    expect(text).toContain("Coastal Threads");
  });

  it("includes the real submission date and time, labelled UTC", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().text).toContain("Sep 20, 2026");
    expect(lastSend().text).toContain("UTC");
  });

  it("never invents a title for a review that has none", async () => {
    fakeReviews = [review({ title: null })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    const { text } = lastSend();
    expect(text).not.toContain("Exactly what I wanted");
    // The body itself is still delivered — only the absent title is absent.
    expect(text).toContain("Arrived in two days and the fit is perfect.");
  });

  it("shows the verified-buyer line only for a genuinely verified review", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });
    expect(lastSend().text).toContain("Verified buyer");

    sendEmail.mockClear();
    fakeReviews = [review({ verifiedPurchase: false })];
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });
    expect(lastSend().text).not.toContain("Verified buyer");
  });

  it("reports the real submission source", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });
    expect(lastSend().text).toContain("Submitted from your storefront");

    sendEmail.mockClear();
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "review_request" });
    expect(lastSend().text).toContain("Submitted from a review request email");
  });

  it("reports the review's real moderation outcome", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });
    expect(lastSend().text).toContain("Published automatically.");

    sendEmail.mockClear();
    fakeReviews = [review({ status: "PENDING", isPublished: false, moderationStatus: "held" })];
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });
    expect(lastSend().text).toContain("Held for moderation");

    sendEmail.mockClear();
    fakeReviews = [review({ status: "PENDING", isPublished: false, moderationStatus: null })];
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });
    expect(lastSend().text).toContain("Waiting for your approval.");
  });

  it("truncates a very long review instead of pasting the whole thing into the email", async () => {
    const long = "A".repeat(900);
    fakeReviews = [review({ content: long })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    const { text } = lastSend();
    expect(text).not.toContain(long);
    expect(text).toContain("Open the review to read the rest.");
  });

  it("never includes the reviewer's email address", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    // The service DOES read reviewerEmail now — it becomes the Reply-To header so a merchant
    // replying reaches the customer (see the Reply-To block below). The contract this asserts
    // is the remaining half: that address belongs in the header and must never be rendered
    // into the body a merchant reads, or forwards.
    expect(lastSend().html).not.toContain("@example.com");
    expect(lastSend().text).not.toContain("@example.com");
  });
});

describe("View review / Reply to review deep links", () => {
  it("builds a View URL that selects this exact review in the admin", () => {
    expect(buildReviewAdminUrl("rev_1")).toBe(`${APP_URL}/app/reviews?review=rev_1`);
  });

  it("builds a Reply URL that additionally opens the reply editor", () => {
    expect(buildReviewReplyUrl("rev_1")).toBe(`${APP_URL}/app/reviews?review=rev_1&reply=1`);
  });

  it("url-encodes the review id", () => {
    expect(buildReviewAdminUrl("rev/1 2")).toBe(`${APP_URL}/app/reviews?review=rev%2F1%202`);
  });

  it("puts both CTAs in the sent email", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    const { html } = lastSend();
    expect(html).toContain(`${APP_URL}/app/reviews?review=rev_1`);
    expect(html).toContain("reply=1");
    expect(html).toContain("View review");
    expect(html).toContain("Reply to review");
  });
});

describe("duplicate suppression against the held-review notification", () => {
  it("skips the send when the held notification already went to the same inbox", async () => {
    await sendNewReviewNotification({
      storeId: "store_1",
      reviewId: "rev_1",
      source: "storefront",
      heldNotificationSentTo: "owner@coastal.test",
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("ignores case and surrounding whitespace when comparing the two recipients", async () => {
    await sendNewReviewNotification({
      storeId: "store_1",
      reviewId: "rev_1",
      source: "storefront",
      heldNotificationSentTo: "  Owner@Coastal.TEST ",
    });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still sends when the held notification went to a different inbox", async () => {
    await sendNewReviewNotification({
      storeId: "store_1",
      reviewId: "rev_1",
      source: "storefront",
      heldNotificationSentTo: "moderator@coastal.test",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(lastSend().to).toBe("owner@coastal.test");
  });
});

describe("failure isolation", () => {
  it("never throws when the email provider fails — a submitted review must not fail on a notification", async () => {
    sendEmail.mockRejectedValueOnce(new Error("provider down"));

    await expect(
      sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Judge.me parity: a merchant replying to a new-review notification must reach the CUSTOMER,
// not Imagyn. That behaviour lives entirely in the Reply-To header, so it is asserted on the
// exact payload handed to the provider — a correct-looking email with the wrong Reply-To sends
// every merchant reply into a support inbox instead of to the shopper.
// ---------------------------------------------------------------------------------------------

describe("Reply-To targets the reviewer", () => {
  it("sets Reply-To to the reviewer's own address", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().replyTo).toBe("dana@example.com");
  });

  it("never points Reply-To at the merchant, the store contact, or an Imagyn address", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    const { replyTo } = lastSend();
    expect(replyTo).not.toBe("owner@coastal.test");
    expect(replyTo).not.toBe("hello@coastal.test");
    expect(replyTo).not.toMatch(/imagyn/i);
  });

  it("tells the merchant where a reply will land, naming the reviewer", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    // Asserted on the plain-text body: React Email emits `<!-- -->` markers around every
    // interpolation in the HTML, so the HTML reads "... straight to <!-- -->Dana Ruiz<!-- -->."
    expect(lastSend().text).toContain("Replying to this email goes straight to Dana Ruiz");
  });

  it("makes no reply promise when no Reply-To could be attached", async () => {
    fakeReviews = [review({ reviewerEmail: null })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().replyTo).toBeUndefined();
    expect(lastSend().text).not.toContain("Replying to this email goes straight to");
  });
});

describe("recipient falls back to Shopify's customer-facing contact email", () => {
  it("uses contactEmail when the merchant nominated no inbox of their own", async () => {
    fakeStores.store_1.newReviewNotifyEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().to).toBe("hello@coastal.test");
  });

  it("still prefers the merchant's explicit preference when both exist", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().to).toBe("owner@coastal.test");
  });

  it("sends nothing when neither address exists", async () => {
    fakeStores.store_1.newReviewNotifyEmail = null;
    fakeStores.store_1.contactEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("respects the merchant's off switch even when contactEmail is available", async () => {
    fakeStores.store_1.newReviewNotifyEnabled = false;
    fakeStores.store_1.newReviewNotifyEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never borrows another store's contact email", async () => {
    fakeStores.store_1.newReviewNotifyEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().to).not.toBe("hello@other.test");
  });
});

// Reviewer-supplied values reach a mail header, so anything that could terminate the header and
// append a recipient is rejected outright rather than escaped.
describe("header injection and invalid addresses", () => {
  const hostile = [
    "dana@example.com\nBcc: attacker@evil.test",
    "dana@example.com\r\nTo: attacker@evil.test",
    "dana@example.com, attacker@evil.test",
    "dana@example.com; attacker@evil.test",
    "<dana@example.com>",
    "dana@example.com>",
    "not-an-email",
    "dana@@example.com",
    "dana@example",
    "",
    "   ",
  ];

  it.each(hostile)("omits Reply-To entirely for %j", async (value) => {
    fakeReviews = [review({ reviewerEmail: value })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    // Still notified — the merchant keeps the email and its working admin links — but with no
    // Reply-To rather than a dangerous or misleading one.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(lastSend().replyTo).toBeUndefined();
  });

  it("refuses to send at all when the configured recipient itself is unsafe", async () => {
    fakeStores.store_1.newReviewNotifyEmail = "owner@coastal.test\nBcc: attacker@evil.test";
    fakeStores.store_1.contactEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("order context, only where it genuinely exists", () => {
  it("includes the real order number from the originating review request", async () => {
    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "review_request" });

    expect(lastSend().html).toContain("#1042");
  });

  it("renders no order number for a storefront review with no originating request", async () => {
    fakeOriginatingRequest = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().html).not.toContain("Order ");
  });

  it("looks up no order at all when the reviewer left no email to match on", async () => {
    fakeReviews = [review({ reviewerEmail: null })];

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(lastSend().html).not.toContain("Order ");
  });
});
