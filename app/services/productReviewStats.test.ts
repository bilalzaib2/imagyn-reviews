// What Product.averageRating / totalReviews / ratingNCount are supposed to count.
//
// These five columns are the denormalized public rating of a product, recalculated by
// recalculateProductStats after every review mutation. On 2026-11-10 they were found to be
// counting every live review regardless of moderation status — LIVE_REVIEW excludes deleted
// and archived reviews, but says nothing about APPROVED.
//
// The consequence was visible on exactly one screen, because no public reader trusts these
// columns: every storefront and SEO path computes its own approved-only figure instead (see
// getPublicReviewSummary, getPublicReviewSummaryBatch, structuredData/sync.server.ts). The
// merchant's own product detail page is the one place that reads the columns directly — so a
// merchant who rejected a one-star review as spam still saw it dragging down the average on
// their product page, and the number they were shown never matched the one on their
// storefront or in their Google rich snippet.
//
// Two more readers depended on the same mistake: the rating breakdown bars beside that
// average, and getProductReviewCoverage's "products without reviews", which counted a product
// whose only review was still pending as a product that already had one.
//
// The intent was never in doubt. archiveReview's own comment says a review being archived
// means "the review just left the public set, so the product's totals are now wrong" — these
// are the public totals. The status filter was simply missing.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReviewStatus } from "./review.shared";

const count = vi.fn();
const aggregate = vi.fn();
const groupBy = vi.fn();
const productUpdate = vi.fn();

vi.mock("../db.server", () => ({
  default: {
    review: {
      get count() {
        return count;
      },
      get aggregate() {
        return aggregate;
      },
      get groupBy() {
        return groupBy;
      },
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    product: {
      get update() {
        return productUpdate;
      },
    },
  },
}));

vi.mock("./permissions", () => ({
  getStorePermissions: vi.fn().mockResolvedValue({ maxPublishedReviews: null }),
  PermissionError: class extends Error {},
}));
vi.mock("./aiSummary.server", () => ({
  maybeAutoRegenerateAiSummary: vi.fn(),
  maybeAutoRegenerateStoreAiSummary: vi.fn(),
  getAiSummariesForProducts: vi.fn().mockResolvedValue({}),
}));
vi.mock("./store.server", () => ({ getStoreById: vi.fn().mockResolvedValue({ id: "store_1" }) }));
vi.mock("./rewards.server", () => ({ evaluateAndIssueReward: vi.fn() }));
vi.mock("./shopifyFlowTrigger.server", () => ({ notifyReviewCreatedFlowTrigger: vi.fn() }));

const { recalculateProductStats } = await import("./review.server");

beforeEach(() => {
  [count, aggregate, groupBy, productUpdate].forEach((fn) => fn.mockReset());
  count.mockResolvedValue(0);
  aggregate.mockResolvedValue({ _avg: { rating: null } });
  groupBy.mockResolvedValue([]);
  productUpdate.mockResolvedValue({});
});

describe("recalculateProductStats counts the public set", () => {
  // One assertion per query rather than one over all three: each is written separately in the
  // source, so each can drift separately, and a single combined check would not say which.
  it.each([
    ["the review count", () => count.mock.calls[0][0].where],
    ["the average rating", () => aggregate.mock.calls[0][0].where],
    ["the per-rating breakdown", () => groupBy.mock.calls[0][0].where],
  ])("filters %s to approved reviews only", async (_label, whereOf) => {
    await recalculateProductStats("prod_1");
    expect(whereOf().status).toBe(ReviewStatus.APPROVED);
  });

  it.each([
    ["the review count", () => count.mock.calls[0][0].where],
    ["the average rating", () => aggregate.mock.calls[0][0].where],
    ["the per-rating breakdown", () => groupBy.mock.calls[0][0].where],
  ])("still excludes deleted and archived reviews from %s", async (_label, whereOf) => {
    await recalculateProductStats("prod_1");
    const where = whereOf();
    expect(where.deletedAt).toBeNull();
    expect(where.archivedAt).toBeNull();
  });

  it("writes the figures it computed onto the product", async () => {
    count.mockResolvedValue(9);
    aggregate.mockResolvedValue({ _avg: { rating: 4.26 } });
    groupBy.mockResolvedValue([
      { rating: 5, _count: { rating: 6 } },
      { rating: 4, _count: { rating: 2 } },
      { rating: 1, _count: { rating: 1 } },
    ]);

    await recalculateProductStats("prod_1");

    const data = productUpdate.mock.calls[0][0].data;
    expect(data.totalReviews).toBe(9);
    expect(data.averageRating).toBe(4.3);
    expect(data.rating5Count).toBe(6);
    expect(data.rating4Count).toBe(2);
    expect(data.rating3Count).toBe(0);
    expect(data.rating1Count).toBe(1);
  });

  it("reports no rating at all when nothing is approved", async () => {
    // Not 0 stars — a product whose only reviews are pending has no public rating, and the
    // detail page's own `totalReviews > 0` check is what turns that into "No ratings yet".
    await recalculateProductStats("prod_1");

    const data = productUpdate.mock.calls[0][0].data;
    expect(data.totalReviews).toBe(0);
    expect(data.averageRating).toBe(0);
  });
});
