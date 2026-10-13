// Exercises api.reviews.tsx's loader — the backend for both the Product Reviews widget and
// the standalone Product AI Summary Theme Block (same endpoint/request shape — see this
// route's own comment on api.reviews.tsx). Regression coverage for the Product AI Summary
// requirements: product context is mandatory (400 without it), and the AI summary returned
// is the real, product-scoped, cache-only ProductAiSummary — never the store-level one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({ admin: {} })),
    },
  },
}));

let storeRecord: { id: string; aiSummaryOnProductReviewsEnabled: boolean };
vi.mock("../services/store.server", () => ({
  getStoreBySlug: vi.fn(async () => storeRecord),
}));

vi.mock("../services/product.server", () => ({
  getOrSyncProductForStoreByShopifyId: vi.fn(async () => ({ id: "product_1", name: "Brown Ceramic Plate" })),
}));

vi.mock("../services/productGroup.server", () => ({
  getGroupedProductIds: vi.fn(async (productId: string) => [productId]),
}));

vi.mock("../services/review.server", () => ({
  getPublicReviewSummary: vi.fn(async () => ({ averageRating: 4.5, totalReviews: 2 })),
  getProductReviews: vi.fn(async () => ({ reviews: [] })),
  getVisitorVotes: vi.fn(async () => ({})),
  rankByHelpfulness: vi.fn((reviews: unknown[]) => reviews),
}));

vi.mock("../services/reviewMedia.server", () => ({
  getProductMediaGallery: vi.fn(async () => []),
}));

vi.mock("../services/widget.server", () => ({
  getStorefrontWidgetSettings: vi.fn(async () => ({})),
}));

vi.mock("../services/permissions", () => ({
  getStorePermissions: vi.fn(async () => ({ canUseMultipleWidgetThemes: false })),
}));

vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: vi.fn(async () => ({})),
}));

vi.mock("../services/achievements.server", () => ({
  getEarnedMedalsForStorefront: vi.fn(async () => []),
}));

let aiSummaryRecord: { summary: string; recommendation: string | null } | null;
const getAiSummaryMock = vi.fn(async () => aiSummaryRecord);
vi.mock("../services/aiSummary.server", () => ({
  getAiSummary: (...args: unknown[]) => getAiSummaryMock(...(args as [])),
}));

const { loader } = await import("./api.reviews");

function requestFor(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  return new Request(`https://example.com/apps/reviews?${search}`);
}

beforeEach(() => {
  storeRecord = { id: "store_1", aiSummaryOnProductReviewsEnabled: true };
  aiSummaryRecord = { summary: "This product's own customers love the fit and quality.", recommendation: "Great for everyday use." };
  getAiSummaryMock.mockClear();
});

describe("api.reviews loader — Product AI Summary requires real product context", () => {
  it("400s when productId is missing — never guesses or falls back to a store-wide summary", async () => {
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com" }) } as never);
    expect(response.status).toBe(400);
    expect(getAiSummaryMock).not.toHaveBeenCalled();
  });

  it("400s when shop is missing too", async () => {
    const response = await loader({ request: requestFor({ productId: "123" }) } as never);
    expect(response.status).toBe(400);
  });

  it("with real product context, reads the AI summary for exactly that product", async () => {
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();

    expect(getAiSummaryMock).toHaveBeenCalledWith("product_1");
    expect(json.aiSummary).toEqual({
      summary: "This product's own customers love the fit and quality.",
      recommendation: "Great for everyday use.",
    });
  });

  it("honestly returns null (never a fabricated or store-level fallback) when this product has no summary yet", async () => {
    aiSummaryRecord = null;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();
    expect(json.aiSummary).toBeNull();
  });
});

describe("api.reviews loader — Show AI Summary display surface (aiSummaryOnProductReviewsEnabled)", () => {
  it("never fetches or returns the AI summary when this surface is disabled", async () => {
    storeRecord.aiSummaryOnProductReviewsEnabled = false;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();

    expect(getAiSummaryMock).not.toHaveBeenCalled();
    expect(json.aiSummary).toBeNull();
  });

  it("still returns the rest of the product data when the AI summary surface is disabled", async () => {
    storeRecord.aiSummaryOnProductReviewsEnabled = false;
    const response = await loader({ request: requestFor({ shop: "verve.myshopify.com", productId: "123" }) } as never);
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.summary).toEqual({ averageRating: 4.5, totalReviews: 2 });
  });
});

// Reported from production as "the App Proxy is broken on purenutrition.com.pk", with the
// evidence being {"ok":false,"error":"shop and productId are required."} in a browser.
//
// The proxy was healthy throughout: opening /apps/reviews by hand reaches the API root with
// no productId, which is a 400 by design, while every widget request supplies one and
// returns 200. These lock in that distinction so the behaviour can't be "fixed" later by
// quietly making productId optional, and so the message a merchant lands on keeps explaining
// itself instead of reading like an outage.
describe("direct browser visit to the proxy root (the Pure Nutrition report)", () => {
  it("still rejects a request with no productId — productId is NOT optional", async () => {
    const response = await loader({ request: requestFor({ shop: "purenutritiononline.myshopify.com" }) } as never);
    expect(response.status).toBe(400);
  });

  it("explains that this is an endpoint rather than a page, and names the missing parameter", async () => {
    const response = await loader({ request: requestFor({ shop: "purenutritiononline.myshopify.com" }) } as never);
    const body = await response.json();

    expect(body.ok).toBe(false);
    expect(body.error).toContain("productId is required");
    // The sentence a confused merchant actually needs.
    expect(body.error).toContain("not a page you can open directly");
  });

  it("names only the genuinely missing parameter when shop is absent", async () => {
    const response = await loader({ request: requestFor({ productId: "7797228798035" }) } as never);
    const body = await response.json();

    expect(body.error).toBe("shop is required.");
  });

  it("the corrected request — the one every widget actually makes — succeeds", async () => {
    // Same numeric Shopify product id Liquid's {{ product.id }} emits on a product page,
    // which is the form the live storefront sends (verified against purenutrition.com.pk).
    const response = await loader({
      request: requestFor({ shop: "purenutritiononline.myshopify.com", productId: "7797228798035" }),
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});
