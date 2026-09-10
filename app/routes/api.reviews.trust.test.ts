// Exercises api.reviews.trust.tsx's loader — the storefront Trust Badge's data source.
// Regression coverage for two real bugs: (1) the AI section used to show a random single
// product's summary labeled as "what customers are saying" about the store, and (2) the Trust
// Badge itself must never be gated behind certification status — a store with real verified
// reviews still gets a real badge regardless of certification outcome, and regardless of
// whether that outcome depends on COD (COD is an accepted IMAGYN payment method as of the
// 2026-09-10 correction — see trustCertification.server.ts's calculatePaymentMethodsPillar).
import { beforeEach, describe, expect, it, vi } from "vitest";

let trustRecord: { status: string; paused: boolean; verifiedReviewCount: number; verifiedAverageRating: number } | null;
let storeAiSummaryRecord: { summary: string; positives: string[]; negatives: string[]; reviewCountUsed: number } | null;

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("../services/store.server", () => ({
  getStoreBySlug: vi.fn(async () => ({ id: "store_1", name: "Verve Handmade" })),
}));

vi.mock("../services/review.server", () => ({
  getPublicStoreReviewSummary: vi.fn(async () => ({ ratingCounts: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 10 } })),
}));

vi.mock("../services/reviewMedia.server", () => ({
  getVerifiedStoreMediaGallery: vi.fn(async () => []),
}));

const getStorefrontAppearanceMock = vi.fn(async () => ({}));
vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: getStorefrontAppearanceMock,
}));

const getStoreAiSummaryMock = vi.fn(async () => storeAiSummaryRecord);
vi.mock("../services/aiSummary.server", () => ({
  getStoreAiSummary: getStoreAiSummaryMock,
}));

vi.mock("../services/trustCertification.server", () => ({
  getTrustCertification: vi.fn(async () => trustRecord),
}));

vi.mock("../services/trustCertification.presentation", () => ({
  PILLAR_STATUS_LABEL: { met: "Met", not_met: "Not met", pending: "Calculating", needs_permission: "Pending" },
  buildPillarViews: vi.fn(() => [
    { key: "reviewPractices", title: "Review Practices", status: "met" },
    { key: "paymentMethods", title: "Payment & Checkout Availability", status: "not_met" },
  ]),
}));

const { loader } = await import("./api.reviews.trust");

function requestFor(shop: string) {
  return new Request(`https://example.com/apps/reviews/trust?shop=${encodeURIComponent(shop)}`);
}

beforeEach(() => {
  trustRecord = {
    status: "not_certified",
    paused: false,
    verifiedReviewCount: 42,
    verifiedAverageRating: 4.6,
  };
  storeAiSummaryRecord = {
    summary: "Customers consistently praise the quality and fast shipping.",
    positives: ["Quality", "Shipping speed"],
    negatives: [],
    reviewCountUsed: 42,
  };
  getStoreAiSummaryMock.mockClear();
  getStorefrontAppearanceMock.mockClear();
});

describe("api.reviews.trust loader — Trust Badge data", () => {
  it("resolves brand tokens for the trust_badge surface (Global Brand -> Surface Override)", async () => {
    await loader({ request: requestFor("verve.myshopify.com") } as never);
    expect(getStorefrontAppearanceMock).toHaveBeenCalledWith("store_1", "trust_badge");
  });

  it("returns real verified rating/count/pillars even for a not_certified store — the badge never depends on certification status", async () => {
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(json.ok).toBe(true);
    expect(json.trust.status).toBe("not_certified");
    expect(json.trust.verifiedReviewCount).toBe(42);
    expect(json.trust.verifiedAverageRating).toBe(4.6);
    expect(json.trust.pillars).toHaveLength(2);
  });

  it("uses the real store-level AI summary, never a product-level one", async () => {
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(getStoreAiSummaryMock).toHaveBeenCalledWith("store_1");
    expect(json.storeAiSummary).toEqual({
      summary: "Customers consistently praise the quality and fast shipping.",
      positives: ["Quality", "Shipping speed"],
      negatives: [],
      reviewCountUsed: 42,
    });
    // The old, buggy field must never reappear in the response shape.
    expect(json).not.toHaveProperty("aiSpotlight");
  });

  it("honestly returns null (not a fabricated empty summary) when no store summary has been generated yet", async () => {
    storeAiSummaryRecord = null;
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(json.storeAiSummary).toBeNull();
  });

  it("still returns real trust data for a certified store — certification and the badge's own data are independent, not exclusive", async () => {
    trustRecord = { status: "certified", paused: false, verifiedReviewCount: 100, verifiedAverageRating: 4.9 };
    const response = await loader({ request: requestFor("verve.myshopify.com") } as never);
    const json = await response.json();

    expect(json.trust.status).toBe("certified");
    expect(json.trust.verifiedReviewCount).toBe(100);
  });
});
