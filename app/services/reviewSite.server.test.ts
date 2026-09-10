// Exercises reviewSite.server.ts's real store-lookup and pass-through logic against mocked
// store.server.ts / review.server.ts functions — no real database. The actual review-query
// correctness (published-only, cursor pagination) is already covered by review.server's own
// tests; this file only verifies reviewSite.server.ts wires them correctly and never leaks a
// wrong store's data or a fabricated result for an unknown slug.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  id: string;
  slug: string;
  name: string;
  aiSummaryOnReviewSiteEnabled?: boolean;
}

let stores: FakeStore[];

const getStoreBySlugMock = vi.fn(async (slug: string) => stores.find((s) => s.slug === slug) ?? null);
vi.mock("./store.server", () => ({
  getStoreBySlug: (slug: string) => getStoreBySlugMock(slug),
}));

const getStoreReviewStatsMock = vi.fn(async () => ({
  totalReviews: 3,
  publishedReviews: 2,
  pendingReviews: 1,
  averageRating: 4.5,
  recentReviews: [],
  autoPublishedToday: 0,
  heldByRules: 0,
  verifiedReviews: 1,
  ratingCounts: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
}));
const getStoreReviewsMock = vi.fn(async () => ({
  reviews: [],
  nextCursor: null,
  hasMore: false,
  totalCount: 0,
}));

vi.mock("./review.server", () => ({
  getStoreReviewStats: (...args: unknown[]) => getStoreReviewStatsMock(...(args as [])),
  getStoreReviews: (...args: unknown[]) => getStoreReviewsMock(...(args as [])),
}));

vi.mock("./review.shared", () => ({ ReviewStatus: { APPROVED: "APPROVED", PENDING: "PENDING" } }));

interface FakeStoreAiSummary {
  summary: string;
  reviewCountUsed: number;
  positives: string[];
  negatives: string[];
  generatedAt: Date;
}

const getStoreAiSummaryMock = vi.fn<() => Promise<FakeStoreAiSummary | null>>(async () => ({
  summary: "Customers love the fast shipping and consistent quality.",
  reviewCountUsed: 42,
  positives: [],
  negatives: [],
  generatedAt: new Date("2026-01-01T00:00:00Z"),
}));
vi.mock("./aiSummary.server", () => ({
  getStoreAiSummary: (...args: unknown[]) => getStoreAiSummaryMock(...(args as [])),
}));

const { getReviewSiteData, getReviewSiteUrl } = await import("./reviewSite.server");

beforeEach(() => {
  stores = [{ id: "store_1", slug: "example-store", name: "Example Store" }];
  getStoreBySlugMock.mockClear();
  getStoreReviewStatsMock.mockClear();
  getStoreReviewsMock.mockClear();
  getStoreAiSummaryMock.mockClear();
});

describe("getReviewSiteData", () => {
  it("returns null for an unknown slug rather than fabricating a page", async () => {
    const result = await getReviewSiteData("no-such-store");
    expect(result).toBeNull();
    expect(getStoreReviewStatsMock).not.toHaveBeenCalled();
  });

  it("returns the real store's stats and reviews for a known slug", async () => {
    const result = await getReviewSiteData("example-store");
    expect(result).toMatchObject({ storeName: "Example Store", averageRating: 4.5, publishedReviews: 2 });
  });

  it("only ever queries APPROVED (published) reviews, never the full moderation queue", async () => {
    await getReviewSiteData("example-store");
    expect(getStoreReviewsMock).toHaveBeenCalledWith("store_1", { status: "APPROVED", cursor: undefined, limit: 12 });
  });

  it("forwards a real cursor for pagination", async () => {
    await getReviewSiteData("example-store", "cursor_abc");
    expect(getStoreReviewsMock).toHaveBeenCalledWith("store_1", { status: "APPROVED", cursor: "cursor_abc", limit: 12 });
  });

  it("never fetches the Store AI Summary when the store hasn't enabled this surface", async () => {
    stores[0].aiSummaryOnReviewSiteEnabled = false;
    const result = await getReviewSiteData("example-store");
    expect(getStoreAiSummaryMock).not.toHaveBeenCalled();
    expect(result?.storeAiSummary).toBeNull();
  });

  it("returns the real, persisted Store AI Summary when the surface is enabled", async () => {
    stores[0].aiSummaryOnReviewSiteEnabled = true;
    const result = await getReviewSiteData("example-store");
    expect(getStoreAiSummaryMock).toHaveBeenCalledWith("store_1");
    expect(result?.storeAiSummary).toEqual({
      summary: "Customers love the fast shipping and consistent quality.",
      reviewCountUsed: 42,
    });
  });

  it("returns null (never a per-product fallback) when the surface is enabled but no summary exists yet", async () => {
    stores[0].aiSummaryOnReviewSiteEnabled = true;
    getStoreAiSummaryMock.mockResolvedValueOnce(null);
    const result = await getReviewSiteData("example-store");
    expect(result?.storeAiSummary).toBeNull();
  });
});

describe("getReviewSiteUrl", () => {
  it("builds a real, stable URL from the store's slug", () => {
    expect(getReviewSiteUrl("example-store")).toMatch(/\/reviews-site\/example-store$/);
  });
});
