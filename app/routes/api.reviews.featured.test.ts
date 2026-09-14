// Exercises api.reviews.featured.tsx's loader — the Review Carousel widget's data source.
// Regression coverage for the Carousel AI Summary requirement: the same one persisted
// summary architecture (ProductAiSummary / StoreAiSummary), never a third AI summary type,
// selected purely by whether this block instance renders on a product page (productId
// present) or elsewhere (store-wide) — and never fetched at all unless the merchant has
// turned this display surface on.
import { beforeEach, describe, expect, it, vi } from "vitest";

let storeRecord: { id: string; aiSummaryOnCarouselEnabled: boolean };
let productAiSummaryRecord: { summary: string } | null;
let storeAiSummaryRecord: { summary: string } | null;
let resolvedProduct: { id: string } | null;

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({ admin: {} })),
    },
  },
}));

vi.mock("../services/store.server", () => ({
  getStoreBySlug: vi.fn(async () => storeRecord),
}));

const getOrSyncProductForStoreByShopifyIdMock = vi.fn(async () => resolvedProduct);
vi.mock("../services/product.server", () => ({
  getOrSyncProductForStoreByShopifyId: (...args: unknown[]) => getOrSyncProductForStoreByShopifyIdMock(...(args as [])),
}));

vi.mock("../services/review.server", () => ({
  getFeaturedReviews: vi.fn(async () => []),
  getPublicReviewSummaryBatch: vi.fn(async () => ({})),
  getPublicStoreReviewSummary: vi.fn(async () => ({ averageRating: 4.6, totalReviews: 20 })),
}));

vi.mock("../services/widget.server", () => ({
  getStorefrontCarouselSettings: vi.fn(async () => ({})),
}));

vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: vi.fn(async () => ({})),
}));

const getAiSummaryMock = vi.fn(async () => productAiSummaryRecord);
const getStoreAiSummaryMock = vi.fn(async () => storeAiSummaryRecord);
vi.mock("../services/aiSummary.server", () => ({
  getAiSummary: (...args: unknown[]) => getAiSummaryMock(...(args as [])),
  getStoreAiSummary: (...args: unknown[]) => getStoreAiSummaryMock(...(args as [])),
}));

const { loader } = await import("./api.reviews.featured");

function requestFor(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return new Request(`https://example.com/apps/reviews/featured?${search}`);
}

beforeEach(() => {
  storeRecord = { id: "store_1", aiSummaryOnCarouselEnabled: true };
  productAiSummaryRecord = { summary: "This product's own customers love the fit." };
  storeAiSummaryRecord = { summary: "Customers across the store love the fast shipping." };
  resolvedProduct = { id: "product_1" };
  getAiSummaryMock.mockClear();
  getStoreAiSummaryMock.mockClear();
  getOrSyncProductForStoreByShopifyIdMock.mockClear();
});

describe("api.reviews.featured loader — Carousel AI Summary context detection", () => {
  it("returns the real, product-scoped summary when a productId is present (product-page placement)", async () => {
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();

    expect(getOrSyncProductForStoreByShopifyIdMock).toHaveBeenCalledWith("123", "store_1", {});
    expect(getAiSummaryMock).toHaveBeenCalledWith("product_1");
    expect(getStoreAiSummaryMock).not.toHaveBeenCalled();
    expect(json.aiSummary).toEqual({ summary: "This product's own customers love the fit.", scope: "product" });
  });

  it("returns the real, store-scoped summary when no productId is present (non-product placement)", async () => {
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com" }) } as never);
    const json = await response.json();

    expect(getOrSyncProductForStoreByShopifyIdMock).not.toHaveBeenCalled();
    expect(getAiSummaryMock).not.toHaveBeenCalled();
    expect(getStoreAiSummaryMock).toHaveBeenCalledWith("store_1");
    expect(json.aiSummary).toEqual({ summary: "Customers across the store love the fast shipping.", scope: "store" });
  });

  it("never fetches either summary when the Carousel AI Summary display surface is disabled", async () => {
    storeRecord.aiSummaryOnCarouselEnabled = false;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();

    expect(getOrSyncProductForStoreByShopifyIdMock).not.toHaveBeenCalled();
    expect(getAiSummaryMock).not.toHaveBeenCalled();
    expect(getStoreAiSummaryMock).not.toHaveBeenCalled();
    expect(json.aiSummary).toBeNull();
  });

  it("honestly returns null (never a fabricated summary) when this product has no summary generated yet", async () => {
    productAiSummaryRecord = null;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();

    expect(json.aiSummary).toBeNull();
  });

  it("returns null instead of throwing when the productId does not resolve to a real product", async () => {
    resolvedProduct = null;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "999" }) } as never);
    const json = await response.json();

    expect(getAiSummaryMock).not.toHaveBeenCalled();
    expect(json.aiSummary).toBeNull();
  });

  it("still returns the real store-wide rating summary regardless of the AI display surface setting", async () => {
    storeRecord.aiSummaryOnCarouselEnabled = false;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com" }) } as never);
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.storeSummary).toEqual({ averageRating: 4.6, totalReviews: 20 });
  });
});
