// Exercises api.reviews.store-ai-summary.tsx's loader — the dedicated Store AI Summary Theme
// App Block's data source. Unlike the Store Reviews widget (api.reviews.store.tsx) and Public
// Review Site (reviewSite.server.ts), this surface has NO admin-side on/off flag of its own —
// a merchant adding/removing the block in the Theme Editor is its only on/off control — so this
// loader must always read the real store-level summary, regardless of the other two surfaces'
// flags, and must never accept or require a productId.
import { beforeEach, describe, expect, it, vi } from "vitest";

let storeAiSummaryRecord: { summary: string; reviewCountUsed: number } | null;

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("../services/store.server", () => ({
  getStoreBySlug: vi.fn(async () => ({ id: "store_1" })),
}));

const getStorefrontAppearanceMock = vi.fn(async () => ({}));
vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: getStorefrontAppearanceMock,
}));

const getStoreAiSummaryMock = vi.fn(async () => storeAiSummaryRecord);
vi.mock("../services/aiSummary.server", () => ({
  getStoreAiSummary: getStoreAiSummaryMock,
}));

const { loader } = await import("./api.reviews.store-ai-summary");

function requestFor(shop: string) {
  return new Request(`https://example.com/apps/reviews/store-ai-summary?shop=${encodeURIComponent(shop)}`);
}

beforeEach(() => {
  storeAiSummaryRecord = {
    summary: "Customers across every product love the fast shipping and consistent quality.",
    reviewCountUsed: 55,
  };
  getStoreAiSummaryMock.mockClear();
  getStorefrontAppearanceMock.mockClear();
});

describe("api.reviews.store-ai-summary loader — Store AI Summary Theme Block data", () => {
  it("resolves brand tokens for the store_ai_summary surface (Global Brand -> Surface Override)", async () => {
    await loader({ request: requestFor("verve.myshopify.com") } as never);
    expect(getStorefrontAppearanceMock).toHaveBeenCalledWith("store_1", "store_ai_summary");
  });

  it("always reads the real, persisted Store AI Summary — no display-surface flag gates this block", async () => {
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(getStoreAiSummaryMock).toHaveBeenCalledWith("store_1");
    expect(json.storeAiSummary).toEqual({
      summary: "Customers across every product love the fast shipping and consistent quality.",
      reviewCountUsed: 55,
    });
  });

  it("honestly returns null (never a fabricated summary) when nothing has been generated yet", async () => {
    storeAiSummaryRecord = null;
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.storeAiSummary).toBeNull();
  });

  it("returns 400 when the request has no shop — never guesses a store", async () => {
    const response = await loader({ request: new Request("https://example.com/apps/reviews/store-ai-summary") } as never);
    expect(response.status).toBe(400);
  });
});
