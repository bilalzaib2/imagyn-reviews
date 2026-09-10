// Exercises api.reviews.store.tsx's loader — the Store Reviews widget's data source.
// Regression coverage for the Display Surfaces feature: the Store AI Summary must only ever
// appear here when the merchant has turned this specific surface on, must be the real
// persisted store-level summary (never a per-product fallback), and must never trigger AI
// generation from a storefront request.
import { beforeEach, describe, expect, it, vi } from "vitest";

let storeRecord: { id: string; aiSummaryOnWidgetEnabled: boolean };
let storeAiSummaryRecord: { summary: string; reviewCountUsed: number } | null;

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("../services/store.server", () => ({
  getStoreBySlug: vi.fn(async () => storeRecord),
}));

vi.mock("../services/review.server", () => ({
  getPublicStoreReviewSummary: vi.fn(async () => ({ averageRating: 4.7, totalReviews: 10, ratingCounts: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 7 } })),
}));

vi.mock("../services/achievements.server", () => ({
  getEarnedMedalsForStorefront: vi.fn(async () => []),
}));

const getStorefrontAppearanceMock = vi.fn(async () => ({}));
vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: getStorefrontAppearanceMock,
}));

const getStoreAiSummaryMock = vi.fn(async () => storeAiSummaryRecord);
vi.mock("../services/aiSummary.server", () => ({
  getStoreAiSummary: getStoreAiSummaryMock,
}));

const { loader } = await import("./api.reviews.store");

function requestFor(shop: string) {
  return new Request(`https://example.com/apps/reviews/store?shop=${encodeURIComponent(shop)}`);
}

beforeEach(() => {
  storeRecord = { id: "store_1", aiSummaryOnWidgetEnabled: false };
  storeAiSummaryRecord = {
    summary: "Customers across every product love the fast shipping and consistent quality.",
    reviewCountUsed: 55,
  };
  getStoreAiSummaryMock.mockClear();
  getStorefrontAppearanceMock.mockClear();
});

describe("api.reviews.store loader — Store Reviews widget data", () => {
  it("resolves brand tokens for the store_reviews surface (Global Brand -> Surface Override)", async () => {
    await loader({ request: requestFor("verve.myshopify.com") } as never);
    expect(getStorefrontAppearanceMock).toHaveBeenCalledWith("store_1", "store_reviews");
  });

  it("never fetches or returns the Store AI Summary when this surface is disabled", async () => {
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(getStoreAiSummaryMock).not.toHaveBeenCalled();
    expect(json.storeAiSummary).toBeNull();
  });

  it("returns the real, persisted Store AI Summary when this surface is enabled", async () => {
    storeRecord.aiSummaryOnWidgetEnabled = true;
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(getStoreAiSummaryMock).toHaveBeenCalledWith("store_1");
    expect(json.storeAiSummary).toEqual({
      summary: "Customers across every product love the fast shipping and consistent quality.",
      reviewCountUsed: 55,
    });
  });

  it("honestly returns null (never a fabricated summary) when enabled but nothing has been generated yet", async () => {
    storeRecord.aiSummaryOnWidgetEnabled = true;
    storeAiSummaryRecord = null;
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(json.storeAiSummary).toBeNull();
  });

  it("still returns the real rating summary regardless of the AI display surface setting", async () => {
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.summary).toEqual({ averageRating: 4.7, totalReviews: 10, ratingCounts: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 7 } });
  });
});
