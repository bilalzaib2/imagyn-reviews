// Exercises the array-productId widening added to getProductReviews/getPublicReviewSummary for
// Product Grouping (see productGroup.server.ts's getGroupedProductIds) — separate from
// review.server.test.ts's own (shallower) mock, since this needs count/aggregate/groupBy/
// findMany to actually filter by the where clause, which that file's mocks don't do.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

interface FakeReview {
  id: string;
  productId: string;
  storeId: string;
  rating: number;
  content: string;
  status: string;
  deletedAt: null;
}

let reviews: FakeReview[];

function matchesProductWhere(review: FakeReview, where: { productId?: string | { in: string[] } }): boolean {
  if (!where.productId) return true;
  if (typeof where.productId === "string") return review.productId === where.productId;
  return where.productId.in.includes(review.productId);
}

vi.mock("../db.server", () => ({
  default: {
    review: {
      count: vi.fn(async ({ where }: { where: { productId?: string | { in: string[] } } }) =>
        reviews.filter((r) => matchesProductWhere(r, where)).length,
      ),
      aggregate: vi.fn(async ({ where }: { where: { productId?: string | { in: string[] } } }) => {
        const matched = reviews.filter((r) => matchesProductWhere(r, where));
        const avg = matched.length ? matched.reduce((sum, r) => sum + r.rating, 0) / matched.length : null;
        return { _avg: { rating: avg } };
      }),
      groupBy: vi.fn(async ({ where }: { where: { productId?: string | { in: string[] } } }) => {
        const matched = reviews.filter((r) => matchesProductWhere(r, where));
        const counts = new Map<number, number>();
        for (const r of matched) counts.set(r.rating, (counts.get(r.rating) ?? 0) + 1);
        return Array.from(counts.entries()).map(([rating, count]) => ({ rating, _count: { rating: count } }));
      }),
      findMany: vi.fn(async ({ where, take }: { where: { productId?: string | { in: string[] } }; take?: number }) => {
        const matched = reviews
          .filter((r) => matchesProductWhere(r, where))
          .map((r) => ({ ...r, product: { id: r.productId, name: "P", handle: null, featuredImage: null }, media: [] }));
        return typeof take === "number" ? matched.slice(0, take) : matched;
      }),
    },
  },
}));

const { getProductReviews, getPublicReviewSummary } = await import("./review.server");

function seed(productId: string, rating: number, id?: string): FakeReview {
  const review: FakeReview = { id: id ?? `r_${reviews.length + 1}`, productId, storeId: "store_1", rating, content: "Great", status: ReviewStatus.APPROVED, deletedAt: null };
  reviews.push(review);
  return review;
}

beforeEach(() => {
  reviews = [];
});

describe("getPublicReviewSummary — single product id (unchanged pre-existing behavior)", () => {
  it("only counts reviews for that exact product", async () => {
    seed("p1", 5);
    seed("p2", 1);

    const summary = await getPublicReviewSummary("p1");
    expect(summary.totalReviews).toBe(1);
    expect(summary.averageRating).toBe(5);
  });
});

describe("getPublicReviewSummary — grouped product ids", () => {
  it("aggregates across every product id in the array", async () => {
    seed("p1", 5);
    seed("p2", 3);

    const summary = await getPublicReviewSummary(["p1", "p2"]);
    expect(summary.totalReviews).toBe(2);
    expect(summary.averageRating).toBe(4);
  });

  it("never includes a product id outside the given array", async () => {
    seed("p1", 5);
    seed("p3", 1);

    const summary = await getPublicReviewSummary(["p1", "p2"]);
    expect(summary.totalReviews).toBe(1);
  });
});

describe("getProductReviews — grouped product ids", () => {
  it("returns reviews from every product id in the array", async () => {
    seed("p1", 5, "r1");
    seed("p2", 4, "r2");
    seed("p3", 2, "r3");

    const result = await getProductReviews(["p1", "p2"]);
    expect(result.reviews.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
});
