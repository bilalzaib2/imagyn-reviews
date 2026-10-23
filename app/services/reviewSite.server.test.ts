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
// Deliberately typed loose on `reviews` so a test can hand it a realistically COMPLETE Prisma
// row (every Review scalar, exactly what review.server.ts's `include`-based reviewInclude
// really returns) and assert the public projection drops the private half of it.
interface FakeReviewPage {
  reviews: Array<Record<string, unknown>>;
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

const getStoreReviewsMock = vi.fn<() => Promise<FakeReviewPage>>(async () => ({
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

const getStorefrontAppearanceMock = vi.fn(async () => ({ colors: { starColor: "#f5a623" } }));
vi.mock("./appearance.server", () => ({
  getStorefrontAppearance: (...args: unknown[]) => getStorefrontAppearanceMock(...(args as [])),
  appearanceService: { getActive: (...args: unknown[]) => getActiveAppearanceMock(...(args as [])) },
}));

let getActiveAppearanceMock = vi.fn(async () => null as { id: string } | null);

const { getReviewSiteData, getReviewSiteUrl } = await import("./reviewSite.server");

beforeEach(() => {
  stores = [{ id: "store_1", slug: "example-store", name: "Example Store" }];
  getStoreBySlugMock.mockClear();
  getStoreReviewStatsMock.mockClear();
  getStoreReviewsMock.mockClear();
  getStoreAiSummaryMock.mockClear();
  getStorefrontAppearanceMock.mockClear();
  getActiveAppearanceMock = vi.fn(async () => null);
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

  it("resolves brand tokens for the public_review_site surface (Global Brand -> Surface Override)", async () => {
    await getReviewSiteData("example-store");
    expect(getStorefrontAppearanceMock).toHaveBeenCalledWith("store_1", "public_review_site");
  });

  it("reports hasCustomBrand: false when the merchant has never configured Brand Studio", async () => {
    const result = await getReviewSiteData("example-store");
    expect(result?.hasCustomBrand).toBe(false);
  });

  it("reports hasCustomBrand: true once the merchant has actually saved a configuration", async () => {
    getActiveAppearanceMock = vi.fn(async () => ({ id: "appearance_1" }));
    const result = await getReviewSiteData("example-store");
    expect(result?.hasCustomBrand).toBe(true);
  });
});

// A realistically COMPLETE row, shaped exactly like what review.server.ts's reviewInclude
// (Prisma `include`, not `select`) actually hands back — private columns and all. The whole
// point of these tests is that this is the real input, so a regression can't hide behind a
// conveniently thin fixture.
function fullReviewRow(): Record<string, unknown> {
  return {
    id: "review_1",
    storeId: "store_1",
    productId: "product_1",
    productTitle: "Linen Shirt",
    rating: 5,
    title: "Excellent",
    content: "Fits perfectly and the fabric is lovely.",
    reviewerName: "A. Customer",
    reviewerEmail: "a.customer@example.com",
    reviewerLocation: "Lahore, PK",
    verifiedPurchase: true,
    status: "APPROVED",
    isPublished: true,
    helpfulCount: 7,
    notHelpfulCount: 1,
    featured: true,
    reply: "Thanks so much!",
    repliedAt: new Date("2026-02-02T00:00:00Z"),
    photoUrls: "legacy,csv,urls",
    deletedAt: null,
    moderationStatus: "held",
    moderationReason: "Matched blocked word: discount",
    externalId: "judgeme-uuid-abc123",
    importSource: "judgeme",
    importBatchId: "batch_9",
    sourceVerified: true,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    updatedAt: new Date("2026-02-01T00:00:00Z"),
    product: {
      id: "product_1",
      name: "Linen Shirt",
      handle: "linen-shirt",
      featuredImage: "https://cdn.example.com/shirt.jpg",
    },
    media: [
      {
        id: "media_1",
        reviewId: "review_1",
        type: "IMAGE",
        url: "https://cdn.example.com/photo.jpg",
        thumbnailUrl: "https://cdn.example.com/photo-thumb.jpg",
        width: 800,
        height: 600,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    ],
    // A live, redeemable Shopify discount code — the single worst field to publish.
    reward: { status: "issued", discountCode: "IMAGYN-THANKS-7F3A", valueType: "percentage", value: 10 },
  };
}

// reviews-site.$slug.tsx is public and unauthenticated, and React Router serializes a loader's
// whole return value into the HTML for hydration regardless of what the component renders. So
// anything reaching ReviewSiteData.reviews is effectively published. These tests pin that
// boundary.
describe("getReviewSiteData — public payload must never carry private fields", () => {
  const FORBIDDEN_FIELDS = [
    "reviewerEmail",
    "reviewerLocation",
    "moderationStatus",
    "moderationReason",
    "externalId",
    "importSource",
    "importBatchId",
    "sourceVerified",
    "reward",
    "storeId",
    "isPublished",
    "photoUrls",
    "deletedAt",
    "status",
    "notHelpfulCount",
    "featured",
    "productTitle",
    "updatedAt",
  ] as const;

  beforeEach(() => {
    getStoreReviewsMock.mockResolvedValueOnce({
      reviews: [fullReviewRow()],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });
  });

  it.each(FORBIDDEN_FIELDS)("never exposes %s", async (field) => {
    const result = await getReviewSiteData("example-store");
    expect(result?.reviews).toHaveLength(1);
    expect(result!.reviews[0]).not.toHaveProperty(field);
  });

  it("never leaks a customer email address anywhere in the serialized payload", async () => {
    const result = await getReviewSiteData("example-store");
    expect(JSON.stringify(result)).not.toContain("a.customer@example.com");
  });

  it("never leaks a redeemable reward discount code anywhere in the serialized payload", async () => {
    const result = await getReviewSiteData("example-store");
    expect(JSON.stringify(result)).not.toContain("IMAGYN-THANKS-7F3A");
  });

  it("never leaks internal moderation reasoning anywhere in the serialized payload", async () => {
    const result = await getReviewSiteData("example-store");
    expect(JSON.stringify(result)).not.toContain("Matched blocked word");
  });

  it("exposes exactly the display-safe field set, and nothing beyond it", async () => {
    const result = await getReviewSiteData("example-store");
    expect(Object.keys(result!.reviews[0]).sort()).toEqual(
      [
        "content",
        "createdAt",
        "id",
        "media",
        "product",
        "rating",
        "reviewerName",
        "title",
        "verifiedPurchase",
      ].sort(),
    );
  });

  it("still renders everything the page actually needs", async () => {
    const result = await getReviewSiteData("example-store");
    expect(result!.reviews[0]).toMatchObject({
      id: "review_1",
      reviewerName: "A. Customer",
      rating: 5,
      title: "Excellent",
      content: "Fits perfectly and the fabric is lovely.",
      verifiedPurchase: true,
    });
    expect(result!.reviews[0].product.name).toBe("Linen Shirt");
  });

  it("projects media down to display-safe fields only (no reviewId back-reference)", async () => {
    const result = await getReviewSiteData("example-store");
    expect(Object.keys(result!.reviews[0].media[0]).sort()).toEqual(
      ["height", "id", "thumbnailUrl", "type", "url", "width"].sort(),
    );
  });

  it("projects product down to display-safe fields only", async () => {
    const result = await getReviewSiteData("example-store");
    expect(Object.keys(result!.reviews[0].product).sort()).toEqual(
      ["featuredImage", "handle", "id", "name"].sort(),
    );
  });
});

describe("getReviewSiteUrl", () => {
  it("builds a real, stable URL from the store's slug", () => {
    expect(getReviewSiteUrl("example-store")).toMatch(/\/reviews-site\/example-store$/);
  });
});
