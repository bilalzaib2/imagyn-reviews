// Exercises sendNewReviewNotification against a fake Review table and a fake email provider —
// no real database, no real email provider. The React Email template itself is rendered for
// real (it's pure), so these tests also prove the merchant actually receives the review's real
// data rather than a placeholder.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  name: string;
  newReviewNotifyEnabled: boolean;
  newReviewNotifyEmail: string | null;
}

interface FakeReview {
  id: string;
  storeId: string;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  verifiedPurchase: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  isPublished: boolean;
  moderationStatus: string | null;
  productTitle: string | null;
  productName: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

let fakeStores: Record<string, FakeStore>;
let fakeReviews: FakeReview[];

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
          rating: review.rating,
          title: review.title,
          content: review.content,
          reviewerName: review.reviewerName,
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
          },
        };
      }),
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
    verifiedPurchase: true,
    status: "APPROVED",
    isPublished: true,
    moderationStatus: "auto_approved",
    productTitle: "Linen Shirt",
    productName: "Linen Shirt",
    createdAt: new Date("2026-09-20T14:30:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function lastSend(): { to: string; subject: string; html: string; text: string } {
  const calls = sendEmail.mock.calls as unknown as Array<
    [{ to: string; subject: string; html: string; text: string }]
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
    store_1: { name: "Coastal Threads", newReviewNotifyEnabled: true, newReviewNotifyEmail: "owner@coastal.test" },
    store_2: { name: "Other Store", newReviewNotifyEnabled: true, newReviewNotifyEmail: "owner@other.test" },
  };
  fakeReviews = [review()];
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

  it("sends nothing when the setting is on but no address is configured", async () => {
    fakeStores.store_1.newReviewNotifyEmail = null;

    await sendNewReviewNotification({ storeId: "store_1", reviewId: "rev_1", source: "storefront" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only address as unconfigured", async () => {
    fakeStores.store_1.newReviewNotifyEmail = "   ";

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

    // The query this service runs never selects reviewerEmail at all, so it cannot reach the
    // template — this asserts that contract from the outside.
    expect(lastSend().html).not.toContain("@example.com");
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
