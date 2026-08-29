// Exercises getPublicStoreReviewSummary — the store-wide rollup backing the Store Reviews
// storefront widget (api.reviews.store.tsx). Separate file/mock from review.server.test.ts
// (that one's db.server mock is scoped to the cross-tenant mutation IDOR suite) — no real
// database, no real network call.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

interface FakeReview {
  storeId: string;
  status: string;
  rating: number;
  deletedAt: Date | null;
}

let reviews: FakeReview[];

function matches(where: { storeId: string; deletedAt: null; status?: string }, review: FakeReview): boolean {
  if (review.storeId !== where.storeId) return false;
  if (review.deletedAt !== where.deletedAt) return false;
  if (where.status !== undefined && review.status !== where.status) return false;
  return true;
}

vi.mock("../db.server", () => ({
  default: {
    review: {
      count: vi.fn(async ({ where }: { where: { storeId: string; deletedAt: null; status: string } }) => {
        return reviews.filter((r) => matches(where, r)).length;
      }),
      aggregate: vi.fn(async ({ where }: { where: { storeId: string; deletedAt: null; status: string } }) => {
        const matching = reviews.filter((r) => matches(where, r));
        const avg = matching.length ? matching.reduce((sum, r) => sum + r.rating, 0) / matching.length : null;
        return { _avg: { rating: avg } };
      }),
      groupBy: vi.fn(async ({ where }: { where: { storeId: string; deletedAt: null; status: string } }) => {
        const matching = reviews.filter((r) => matches(where, r));
        const counts = new Map<number, number>();
        for (const r of matching) {
          counts.set(r.rating, (counts.get(r.rating) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([rating, count]) => ({ rating, _count: { rating: count } }));
      }),
    },
  },
}));

const { getPublicStoreReviewSummary } = await import("./review.server");

describe("getPublicStoreReviewSummary", () => {
  beforeEach(() => {
    reviews = [
      { storeId: "store_1", status: ReviewStatus.APPROVED, rating: 5, deletedAt: null },
      { storeId: "store_1", status: ReviewStatus.APPROVED, rating: 5, deletedAt: null },
      { storeId: "store_1", status: ReviewStatus.APPROVED, rating: 4, deletedAt: null },
      // Pending — must never count toward a public, unauthenticated summary.
      { storeId: "store_1", status: ReviewStatus.PENDING, rating: 1, deletedAt: null },
      // Soft-deleted — must never count.
      { storeId: "store_1", status: ReviewStatus.APPROVED, rating: 1, deletedAt: new Date() },
      // A different store's review — must never leak in.
      { storeId: "store_2", status: ReviewStatus.APPROVED, rating: 1, deletedAt: null },
    ];
    vi.clearAllMocks();
  });

  it("rolls up only this store's approved, non-deleted reviews — same scope as the per-product summary", async () => {
    const result = await getPublicStoreReviewSummary("store_1");

    expect(result.totalReviews).toBe(3);
    expect(result.averageRating).toBe(4.7);
    expect(result.ratingCounts).toEqual({ 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 });
  });

  it("never includes another store's reviews", async () => {
    const result = await getPublicStoreReviewSummary("store_2");

    expect(result.totalReviews).toBe(1);
    expect(result.ratingCounts?.[1]).toBe(1);
  });

  it("returns a zeroed summary for a store with no approved reviews yet, instead of throwing", async () => {
    const result = await getPublicStoreReviewSummary("store_with_nothing");

    expect(result.totalReviews).toBe(0);
    expect(result.averageRating).toBe(0);
    expect(result.ratingCounts).toEqual({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
  });
});
