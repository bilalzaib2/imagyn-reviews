// Exercises api.reviews.floating.tsx's loader — the Floating Reviews widget's data source.
// The behavior that genuinely needs covering is its context awareness (product page vs. every
// other page, plus the store-wide fallback for an unreviewed product), that it only ever reads
// APPROVED reviews, that it serializes no private customer data, and that it resolves its own
// Brand Studio surface.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "@prisma/client";

let storeRecord: { id: string; name: string } | null;
let productRecord: { id: string; name: string } | null;
let productSummary: { averageRating: number; totalReviews: number; ratingCounts: Record<number, number> };
let storeSummary: { averageRating: number; totalReviews: number; ratingCounts: Record<number, number> };

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({ admin: { graphql: vi.fn() } })),
    },
  },
}));

const getStoreBySlugMock = vi.fn(async () => storeRecord);
vi.mock("../services/store.server", () => ({
  getStoreBySlug: getStoreBySlugMock,
}));

const getOrSyncProductMock = vi.fn(async () => productRecord);
vi.mock("../services/product.server", () => ({
  getOrSyncProductForStoreByShopifyId: getOrSyncProductMock,
}));

const getGroupedProductIdsMock = vi.fn(async (productId: string) => [productId]);
vi.mock("../services/productGroup.server", () => ({
  getGroupedProductIds: getGroupedProductIdsMock,
}));

function fakeReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev_1",
    reviewerName: "Dana Ruiz",
    // Private fields are deliberately present on the row the service layer returns — the point
    // of these tests is that the loader never serializes them.
    reviewerEmail: "dana@example.com",
    reviewerLocation: "Lisbon, Portugal",
    verifiedPurchase: true,
    rating: 5,
    title: "Exactly what I wanted",
    content: "Arrived in two days and the fit is perfect.",
    createdAt: new Date("2026-09-20T14:30:00Z"),
    reply: "Thanks Dana!",
    status: ReviewStatus.APPROVED,
    product: { name: "Linen Shirt" },
    media: [
      { id: "med_1", type: "image", url: "https://cdn.test/a.jpg", thumbnailUrl: null, width: 800, height: 600 },
    ],
    ...overrides,
  };
}

let productReviewRows: Array<ReturnType<typeof fakeReview>>;
let storeReviewRows: Array<ReturnType<typeof fakeReview>>;

const getProductReviewsMock = vi.fn(async () => ({ reviews: productReviewRows }));
const getStoreReviewsMock = vi.fn(async () => ({ reviews: storeReviewRows }));
const getPublicReviewSummaryMock = vi.fn(async () => productSummary);
const getPublicStoreReviewSummaryMock = vi.fn(async () => storeSummary);

vi.mock("../services/review.server", () => ({
  getProductReviews: (...args: unknown[]) => getProductReviewsMock(...(args as [])),
  getStoreReviews: (...args: unknown[]) => getStoreReviewsMock(...(args as [])),
  getPublicReviewSummary: (...args: unknown[]) => getPublicReviewSummaryMock(...(args as [])),
  getPublicStoreReviewSummary: (...args: unknown[]) => getPublicStoreReviewSummaryMock(...(args as [])),
}));

const getStorefrontAppearanceMock = vi.fn(async () => ({ corners: { radius: 8 } }));
vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: getStorefrontAppearanceMock,
}));

const { loader } = await import("./api.reviews.floating");

function requestFor(params: { shop?: string; productId?: string } = {}) {
  const url = new URL("https://example.com/apps/reviews/floating");
  if (params.shop !== undefined) {
    url.searchParams.set("shop", params.shop);
  }
  if (params.productId !== undefined) {
    url.searchParams.set("productId", params.productId);
  }
  return new Request(url.toString());
}

async function load(params: { shop?: string; productId?: string } = { shop: "verve.myshopify.com" }) {
  const response = await loader({ request: requestFor(params) } as never);
  return { response, json: await response.json() };
}

beforeEach(() => {
  storeRecord = { id: "store_1", name: "Coastal Threads" };
  productRecord = { id: "product_1", name: "Linen Shirt" };
  productSummary = { averageRating: 4.8, totalReviews: 12, ratingCounts: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 10 } };
  storeSummary = { averageRating: 4.5, totalReviews: 140, ratingCounts: { 1: 2, 2: 3, 3: 10, 4: 40, 5: 85 } };
  productReviewRows = [fakeReview()];
  storeReviewRows = [fakeReview({ id: "rev_store", product: { name: "Canvas Tote" } })];
  [
    getStoreBySlugMock,
    getOrSyncProductMock,
    getGroupedProductIdsMock,
    getProductReviewsMock,
    getStoreReviewsMock,
    getPublicReviewSummaryMock,
    getPublicStoreReviewSummaryMock,
    getStorefrontAppearanceMock,
  ].forEach((mock) => mock.mockClear());
});

describe("request validation and store resolution", () => {
  it("rejects a request with no shop", async () => {
    const { response, json } = await load({});
    expect(response.status).toBe(400);
    expect(json.ok).toBe(false);
  });

  it("returns 404 for a shop with no store record", async () => {
    storeRecord = null;
    const { response, json } = await load({ shop: "unknown.myshopify.com" });
    expect(response.status).toBe(404);
    expect(json.ok).toBe(false);
  });

  it("resolves the store from the App-Proxy-verified shop domain, never a client-supplied id", async () => {
    await load({ shop: "verve.myshopify.com" });
    expect(getStoreBySlugMock).toHaveBeenCalledWith("verve");
  });
});

describe("Brand Studio integration", () => {
  it("resolves brand tokens for the floating_reviews surface (global brand -> surface override)", async () => {
    await load({ shop: "verve.myshopify.com" });
    expect(getStorefrontAppearanceMock).toHaveBeenCalledWith("store_1", "floating_reviews");
  });

  it("returns the resolved tokens in the response", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });
    expect(json.appearance).toEqual({ corners: { radius: 8 } });
  });
});

describe("store context (every page that is not a product page)", () => {
  it("answers store-wide when no productId is given", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });

    expect(json.ok).toBe(true);
    expect(json.scope).toBe("store");
    expect(json.productName).toBeNull();
    expect(json.summary).toEqual(storeSummary);
    expect(json.reviews).toHaveLength(1);
    expect(json.reviews[0].id).toBe("rev_store");
  });

  it("never resolves a product when no productId is given", async () => {
    await load({ shop: "verve.myshopify.com" });
    expect(getOrSyncProductMock).not.toHaveBeenCalled();
  });

  it("names the product each store-wide review is about", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });
    expect(json.reviews[0].productName).toBe("Canvas Tote");
  });
});

describe("product context", () => {
  it("answers with the product's own reviews and rating on a product page", async () => {
    const { json } = await load({ shop: "verve.myshopify.com", productId: "998877" });

    expect(json.scope).toBe("product");
    expect(json.productName).toBe("Linen Shirt");
    expect(json.summary).toEqual(productSummary);
    expect(json.reviews[0].id).toBe("rev_1");
    expect(getStoreReviewsMock).not.toHaveBeenCalled();
  });

  it("resolves the Shopify product id against this store only", async () => {
    await load({ shop: "verve.myshopify.com", productId: "998877" });
    expect(getOrSyncProductMock).toHaveBeenCalledWith("998877", "store_1", expect.anything());
  });

  it("includes every product in a Product Group, matching the Product Reviews widget", async () => {
    getGroupedProductIdsMock.mockImplementationOnce(async () => ["product_1", "product_2"]);

    await load({ shop: "verve.myshopify.com", productId: "998877" });

    expect(getPublicReviewSummaryMock).toHaveBeenCalledWith(["product_1", "product_2"]);
    expect(getProductReviewsMock).toHaveBeenCalledWith(
      ["product_1", "product_2"],
      expect.objectContaining({ status: ReviewStatus.APPROVED }),
    );
  });

  it("falls back to store-wide when the product has no approved reviews yet", async () => {
    productSummary = { averageRating: 0, totalReviews: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    productReviewRows = [];

    const { json } = await load({ shop: "verve.myshopify.com", productId: "998877" });

    // Reported honestly as store scope, so the widget never presents store numbers as this
    // product's own rating.
    expect(json.scope).toBe("store");
    expect(json.productName).toBeNull();
    expect(json.summary).toEqual(storeSummary);
  });

  it("falls back to store-wide when the productId does not resolve to a product of this store", async () => {
    getOrSyncProductMock.mockImplementationOnce(async () => null);

    const { json } = await load({ shop: "verve.myshopify.com", productId: "not-ours" });

    expect(json.scope).toBe("store");
    expect(getStoreReviewsMock).toHaveBeenCalled();
  });
});

describe("published-only and no fabricated data", () => {
  it("only ever requests APPROVED reviews, on both the product and the store path", async () => {
    await load({ shop: "verve.myshopify.com", productId: "998877" });
    expect(getProductReviewsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: ReviewStatus.APPROVED }),
    );

    await load({ shop: "verve.myshopify.com" });
    expect(getStoreReviewsMock).toHaveBeenCalledWith(
      "store_1",
      expect.objectContaining({ status: ReviewStatus.APPROVED }),
    );
  });

  it("returns an empty review list rather than inventing reviews for a store with none", async () => {
    storeSummary = { averageRating: 0, totalReviews: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    storeReviewRows = [];

    const { json } = await load({ shop: "verve.myshopify.com" });

    expect(json.ok).toBe(true);
    expect(json.reviews).toEqual([]);
    expect(json.summary.totalReviews).toBe(0);
    expect(json.summary.averageRating).toBe(0);
  });

  it("keeps a missing review title null instead of substituting anything for it", async () => {
    storeReviewRows = [fakeReview({ title: null })];

    const { json } = await load({ shop: "verve.myshopify.com" });

    expect(json.reviews[0].title).toBeNull();
    expect(json.reviews[0].content).toBe("Arrived in two days and the fit is perfect.");
  });

  it("reports verified status exactly as the review row records it", async () => {
    storeReviewRows = [fakeReview({ verifiedPurchase: false })];

    const { json } = await load({ shop: "verve.myshopify.com" });

    expect(json.reviews[0].verifiedPurchase).toBe(false);
  });

  it("returns only real media rows, with their real dimensions", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });

    expect(json.reviews[0].media).toEqual([
      { id: "med_1", type: "image", url: "https://cdn.test/a.jpg", thumbnailUrl: null, width: 800, height: 600 },
    ]);
  });

  it("includes the merchant's public reply when there is one", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });
    expect(json.reviews[0].reply).toBe("Thanks Dana!");
  });
});

describe("no private customer data is ever exposed", () => {
  it("never serializes reviewerEmail or reviewerLocation", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });

    const body = JSON.stringify(json);
    expect(body).not.toContain("dana@example.com");
    expect(body).not.toContain("Lisbon");
    expect(json.reviews[0].reviewerEmail).toBeUndefined();
    expect(json.reviews[0].reviewerLocation).toBeUndefined();
  });

  it("serializes exactly the display-safe field set and nothing more", async () => {
    const { json } = await load({ shop: "verve.myshopify.com" });

    expect(Object.keys(json.reviews[0]).sort()).toEqual(
      [
        "content",
        "createdAt",
        "id",
        "media",
        "productName",
        "rating",
        "reply",
        "reviewerName",
        "title",
        "verifiedPurchase",
      ].sort(),
    );
  });
});
