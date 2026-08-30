// Exercises review.server.ts's storeId ownership checks against a fake in-memory Prisma
// client — no real database. This is the regression suite for the cross-tenant review IDOR
// found in the master feature audit: every mutation must reject an id/productId that belongs
// to a different store with the same generic "not found" a bogus id would produce. See
// widget.server.test.ts / appearance.server.test.ts for the same mocking convention.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

interface FakeReview {
  id: string;
  storeId: string;
  productId: string;
  productTitle: string | null;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  reviewerEmail: string | null;
  reviewerLocation: string | null;
  verifiedPurchase: boolean;
  featured: boolean;
  photoUrls: string | null;
  status: string;
  isPublished: boolean;
  reply: string | null;
  repliedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  media: Array<{ type: string }>;
}

interface FakeProduct {
  id: string;
  storeId: string;
  name: string;
}

let reviews: FakeReview[];
let products: FakeProduct[];
let nextId: number;

function seedReview(overrides: Partial<FakeReview> & { id: string; storeId: string; productId: string }): FakeReview {
  const review: FakeReview = {
    productTitle: null,
    rating: 5,
    title: "Great",
    content: "Loved it",
    reviewerName: "Jordan",
    reviewerEmail: null,
    reviewerLocation: null,
    verifiedPurchase: false,
    featured: false,
    photoUrls: null,
    status: ReviewStatus.PENDING,
    isPublished: false,
    reply: null,
    repliedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    // Mirrors review.server.ts's real reviewInclude (always includes media) — setReviewStatus
    // reads review.media directly to derive hasPhoto/hasVideo for issueRewardIfEligible.
    media: [],
    ...overrides,
  };
  reviews.push(review);
  return review;
}

function seedProduct(overrides: Partial<FakeProduct> & { id: string; storeId: string }): FakeProduct {
  const product: FakeProduct = { name: "Test Product", ...overrides };
  products.push(product);
  return product;
}

vi.mock("../db.server", () => ({
  default: {
    store: {
      // "owner" => maxPublishedReviews is null (unlimited) — the published-review cap is
      // covered by review.server's own pre-existing tests/behavior, not this file's concern.
      // rewardsEnabled: false means issueRewardIfEligible's fire-and-forget call always
      // short-circuits on evaluateEligibility before touching Shopify or email — Rewards'
      // own behavior is covered by rewards.server.test.ts, not this file's concern.
      findUnique: vi.fn(async () => ({ plan: "owner" })),
      findUniqueOrThrow: vi.fn(async () => ({ rewardsEnabled: false, rewardValueType: "percentage", rewardValue: 10, rewardMinRating: 4, rewardRequireVerified: true, rewardRequirePhoto: false, rewardRequireVideo: false })),
    },
    product: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = products.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id, storeId: product.storeId, name: product.name } : null;
      }),
      update: vi.fn(async () => ({})),
    },
    productAiSummary: {
      findUnique: vi.fn(async () => null),
    },
    // issueRewardIfEligible (fired, not awaited, by setReviewStatus on APPROVED) calls
    // evaluateAndIssueReward, which checks for an existing Reward row first — returning null
    // here just means "not evaluated yet." See store.findUniqueOrThrow above for why nothing
    // past this point ever calls Shopify or sends email in this file's tests.
    reward: {
      findUnique: vi.fn(async () => null),
    },
    review: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string; deletedAt: null } }) => {
        return reviews.find((r) => r.id === where.id && r.storeId === where.storeId && r.deletedAt === null) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; storeId: string; deletedAt: null } }) => {
        return reviews.filter(
          (r) => where.id.in.includes(r.id) && r.storeId === where.storeId && r.deletedAt === null,
        );
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeReview> }) => {
        const review = reviews.find((r) => r.id === where.id);
        if (!review) throw new Error("Row not found");
        Object.assign(review, data);
        return review;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] }; deletedAt: null }; data: Partial<FakeReview> }) => {
        const targets = reviews.filter((r) => where.id.in.includes(r.id) && r.deletedAt === null);
        targets.forEach((r) => Object.assign(r, data));
        return { count: targets.length };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const review = seedReview({
          id: `review_${nextId++}`,
          storeId: data.storeId as string,
          productId: data.productId as string,
          reviewerName: data.reviewerName as string,
          content: data.content as string,
          rating: data.rating as number,
        });
        return review;
      }),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _avg: { rating: null } })),
      groupBy: vi.fn(async () => []),
    },
  },
}));

const {
  approveReview,
  bulkDeleteReviews,
  bulkModerateReviews,
  createReview,
  deleteReply,
  deleteReview,
  rejectReview,
  replyToReview,
  updateReview,
} = await import("./review.server");

beforeEach(() => {
  reviews = [];
  products = [];
  nextId = 1;
  seedProduct({ id: "product_1", storeId: "store_1" });
  seedProduct({ id: "product_2", storeId: "store_2" });
});

describe("cross-tenant review mutation isolation", () => {
  it("updateReview rejects a review belonging to a different store", async () => {
    seedReview({ id: "review_1", storeId: "store_2", productId: "product_2" });

    await expect(updateReview("store_1", "review_1", { content: "Hijacked" })).rejects.toThrow("Review not found.");
    expect(reviews.find((r) => r.id === "review_1")?.content).toBe("Loved it");
  });

  it("deleteReview rejects a review belonging to a different store", async () => {
    seedReview({ id: "review_1", storeId: "store_2", productId: "product_2" });

    await expect(deleteReview("store_1", "review_1")).rejects.toThrow("Review not found.");
    expect(reviews.find((r) => r.id === "review_1")?.deletedAt).toBeNull();
  });

  it("approveReview/rejectReview reject a review belonging to a different store", async () => {
    seedReview({ id: "review_1", storeId: "store_2", productId: "product_2" });

    await expect(approveReview("store_1", "review_1")).rejects.toThrow("Review not found.");
    await expect(rejectReview("store_1", "review_1")).rejects.toThrow("Review not found.");
    expect(reviews.find((r) => r.id === "review_1")?.status).toBe(ReviewStatus.PENDING);
  });

  it("approveReview succeeds for the caller's own review", async () => {
    seedReview({ id: "review_1", storeId: "store_1", productId: "product_1" });

    const approved = await approveReview("store_1", "review_1");
    expect(approved.status).toBe(ReviewStatus.APPROVED);
    expect(approved.isPublished).toBe(true);
  });

  it("replyToReview/deleteReply reject a review belonging to a different store", async () => {
    seedReview({ id: "review_1", storeId: "store_2", productId: "product_2" });

    await expect(replyToReview("store_1", "review_1", "Thanks!")).rejects.toThrow("Review not found.");
    await expect(deleteReply("store_1", "review_1")).rejects.toThrow("Review not found.");
    expect(reviews.find((r) => r.id === "review_1")?.reply).toBeNull();
  });

  it("updateReview rejects reassigning a review onto another store's product", async () => {
    seedReview({ id: "review_1", storeId: "store_1", productId: "product_1" });

    await expect(updateReview("store_1", "review_1", { productId: "product_2" })).rejects.toThrow(
      "Product not found.",
    );
    expect(reviews.find((r) => r.id === "review_1")?.productId).toBe("product_1");
  });
});

describe("createReview — product ownership", () => {
  it("rejects a productId that belongs to a different store", async () => {
    await expect(
      createReview("store_1", {
        productId: "product_2",
        rating: 5,
        content: "Nice",
        reviewerName: "Jordan",
      }),
    ).rejects.toThrow("Product not found.");
    expect(reviews).toHaveLength(0);
  });

  it("succeeds for a product that belongs to the caller's store", async () => {
    const review = await createReview("store_1", {
      productId: "product_1",
      rating: 5,
      content: "Nice",
      reviewerName: "Jordan",
    });

    expect(review.storeId).toBe("store_1");
    expect(review.productId).toBe("product_1");
  });
});

describe("bulkModerateReviews / bulkDeleteReviews — cross-tenant isolation", () => {
  it("only moderates ids that belong to the calling store, silently skipping the rest", async () => {
    seedReview({ id: "own_1", storeId: "store_1", productId: "product_1" });
    seedReview({ id: "foreign_1", storeId: "store_2", productId: "product_2" });

    const result = await bulkModerateReviews("store_1", ["own_1", "foreign_1"], ReviewStatus.APPROVED);

    expect(result.count).toBe(1);
    expect(result.affectedProductIds).toEqual(["product_1"]);
    expect(reviews.find((r) => r.id === "own_1")?.status).toBe(ReviewStatus.APPROVED);
    expect(reviews.find((r) => r.id === "foreign_1")?.status).toBe(ReviewStatus.PENDING);
  });

  it("only deletes ids that belong to the calling store, silently skipping the rest", async () => {
    seedReview({ id: "own_1", storeId: "store_1", productId: "product_1" });
    seedReview({ id: "foreign_1", storeId: "store_2", productId: "product_2" });

    const result = await bulkDeleteReviews("store_1", ["own_1", "foreign_1"]);

    expect(result.count).toBe(1);
    expect(reviews.find((r) => r.id === "own_1")?.deletedAt).not.toBeNull();
    expect(reviews.find((r) => r.id === "foreign_1")?.deletedAt).toBeNull();
  });

  it("returns a zero result when every id in the selection belongs to another store", async () => {
    seedReview({ id: "foreign_1", storeId: "store_2", productId: "product_2" });

    const result = await bulkModerateReviews("store_1", ["foreign_1"], ReviewStatus.REJECTED);
    expect(result).toEqual({ count: 0, affectedProductIds: [] });
  });
});
