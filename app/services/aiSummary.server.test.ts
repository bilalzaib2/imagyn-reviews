// Exercises regenerateAiSummary's storeId ownership check against a fake in-memory Prisma
// client — no real database, no real AI provider call for the cross-tenant case. Regression
// test for the AI-summary cross-tenant IDOR found in the master feature audit: a merchant
// could previously regenerate (and overwrite) another store's ProductAiSummary just by
// knowing its productId, with the plan check running against the *victim* store's plan.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProduct {
  id: string;
  storeId: string;
  name: string;
}

interface FakeReview {
  productId: string;
  rating: number;
  title: string | null;
  content: string;
  status: string;
  deletedAt: Date | null;
}

interface FakeStore {
  id: string;
  name: string;
}

let stores: FakeStore[];
let products: FakeProduct[];
let reviews: FakeReview[];
let summaries: Map<string, { id: string; productId: string; summary: string; positives: string; negatives: string; recommendation: string; reviewCountUsed: number; provider: string; modelUsed: string; generatedAt: Date; updatedAt: Date }>;
let storeSummaries: Map<string, { id: string; storeId: string; summary: string; positives: string; negatives: string; recommendation: string; reviewCountUsed: number; provider: string; modelUsed: string; generatedAt: Date; updatedAt: Date }>;
let generateReviewSummaryMock: ReturnType<typeof vi.fn>;

vi.mock("../db.server", () => ({
  default: {
    store: {
      // "owner" => every permission (including canUseAI) is granted — this file's focus is
      // ownership scoping, not plan gating, which aiSummary.server.ts already has its own
      // assertPermission call for. Real id/name are still returned (looked up by the `where`
      // clause) so regenerateStoreAiSummary's real store-name lookup has something real to use.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const store = stores.find((s) => s.id === where.id);
        return store ? { id: store.id, name: store.name, plan: "owner" } : null;
      }),
    },
    product: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = products.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id, name: product.name, storeId: product.storeId } : null;
      }),
    },
    review: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return reviews.filter((r) => {
          if (where.productId && r.productId !== where.productId) return false;
          if (where.storeId && !products.some((p) => p.id === r.productId && p.storeId === where.storeId)) return false;
          return r.deletedAt === null && r.status === where.status;
        });
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return reviews.filter((r) => {
          if (where.productId && r.productId !== where.productId) return false;
          if (where.storeId && !products.some((p) => p.id === r.productId && p.storeId === where.storeId)) return false;
          return r.deletedAt === null && r.status === where.status;
        }).length;
      }),
    },
    productAiSummary: {
      findUnique: vi.fn(async ({ where }: { where: { productId: string } }) => summaries.get(where.productId) ?? null),
      upsert: vi.fn(async ({
        where,
        create,
      }: {
        where: { productId: string };
        create: {
          summary: string;
          positives: string;
          negatives: string;
          recommendation: string;
          reviewCountUsed: number;
          provider: string;
          modelUsed: string;
        };
      }) => {
        const row = {
          id: `summary_${where.productId}`,
          productId: where.productId,
          summary: create.summary,
          positives: create.positives,
          negatives: create.negatives,
          recommendation: create.recommendation,
          reviewCountUsed: create.reviewCountUsed,
          provider: create.provider,
          modelUsed: create.modelUsed,
          generatedAt: new Date(),
          updatedAt: new Date(),
        };
        summaries.set(where.productId, row);
        return row;
      }),
    },
    storeAiSummary: {
      findUnique: vi.fn(async ({ where }: { where: { storeId: string } }) => storeSummaries.get(where.storeId) ?? null),
      upsert: vi.fn(async ({
        where,
        create,
      }: {
        where: { storeId: string };
        create: {
          summary: string;
          positives: string;
          negatives: string;
          recommendation: string;
          reviewCountUsed: number;
          provider: string;
          modelUsed: string;
        };
      }) => {
        const row = {
          id: `store_summary_${where.storeId}`,
          storeId: where.storeId,
          summary: create.summary,
          positives: create.positives,
          negatives: create.negatives,
          recommendation: create.recommendation,
          reviewCountUsed: create.reviewCountUsed,
          provider: create.provider,
          modelUsed: create.modelUsed,
          generatedAt: new Date(),
          updatedAt: new Date(),
        };
        storeSummaries.set(where.storeId, row);
        return row;
      }),
    },
  },
}));

vi.mock("./ai/provider.server", () => ({
  getAiProvider: () => ({
    name: "fake-provider",
    generateReviewSummary: generateReviewSummaryMock,
  }),
}));

const { regenerateAiSummary, regenerateStoreAiSummary, getStoreAiSummary, maybeAutoRegenerateStoreAiSummary } =
  await import("./aiSummary.server");

beforeEach(() => {
  stores = [
    { id: "store_1", name: "Verve Handmade" },
    { id: "store_2", name: "Other Store" },
  ];
  products = [
    { id: "product_1", storeId: "store_1", name: "Own Product" },
    { id: "product_2", storeId: "store_2", name: "Other Store's Product" },
  ];
  reviews = [
    { productId: "product_1", rating: 5, title: "Great", content: "Loved it", status: "APPROVED", deletedAt: null },
    { productId: "product_2", rating: 5, title: "Great", content: "Loved it", status: "APPROVED", deletedAt: null },
  ];
  summaries = new Map();
  storeSummaries = new Map();
  generateReviewSummaryMock = vi.fn(async () => ({
    summary: "Customers love it.",
    positives: ["Great quality"],
    negatives: [],
    recommendation: "Anyone who wants a reliable product.",
    modelUsed: "fake-model",
  }));
});

describe("regenerateAiSummary — cross-tenant isolation", () => {
  it("rejects a productId that belongs to a different store", async () => {
    await expect(regenerateAiSummary("store_1", "product_2")).rejects.toThrow("Product not found.");
    expect(summaries.has("product_2")).toBe(false);
  });

  it("does not overwrite another store's ProductAiSummary as a side effect of a rejected call", async () => {
    summaries.set("product_2", {
      id: "existing",
      productId: "product_2",
      summary: "Original summary belonging to store_2.",
      positives: "[]",
      negatives: "[]",
      recommendation: "",
      reviewCountUsed: 1,
      provider: "fake-provider",
      modelUsed: "fake-model",
      generatedAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(regenerateAiSummary("store_1", "product_2")).rejects.toThrow("Product not found.");
    expect(summaries.get("product_2")?.summary).toBe("Original summary belonging to store_2.");
  });

  it("succeeds for a product that belongs to the caller's own store", async () => {
    const result = await regenerateAiSummary("store_1", "product_1");

    expect(result.productId).toBe("product_1");
    expect(result.summary).toBe("Customers love it.");
    expect(summaries.get("product_1")?.summary).toBe("Customers love it.");
  });
});

describe("getStoreAiSummary", () => {
  it("returns null when no store summary has ever been generated", async () => {
    const result = await getStoreAiSummary("store_1");
    expect(result).toBeNull();
  });

  it("is a pure cache read — never calls the AI provider, so a storefront read can never trigger generation", async () => {
    await getStoreAiSummary("store_1");
    expect(generateReviewSummaryMock).not.toHaveBeenCalled();
  });

  it("returns the cached summary on repeated reads without regenerating", async () => {
    await regenerateStoreAiSummary("store_1");
    generateReviewSummaryMock.mockClear();

    const first = await getStoreAiSummary("store_1");
    const second = await getStoreAiSummary("store_1");

    expect(first?.summary).toBe(second?.summary);
    expect(generateReviewSummaryMock).not.toHaveBeenCalled();
  });
});

describe("regenerateStoreAiSummary", () => {
  it("throws when the store has no approved reviews to summarize yet", async () => {
    reviews = [];
    await expect(regenerateStoreAiSummary("store_1")).rejects.toThrow("This store has no approved reviews");
    expect(generateReviewSummaryMock).not.toHaveBeenCalled();
  });

  it("generates and persists a real, store-scoped summary from approved reviews", async () => {
    const result = await regenerateStoreAiSummary("store_1");

    expect(result.storeId).toBe("store_1");
    expect(result.summary).toBe("Customers love it.");
    expect(result.reviewCountUsed).toBe(1);
    expect(storeSummaries.get("store_1")?.summary).toBe("Customers love it.");

    // scope: "store" is passed through to the provider so the prompt frames the request as a
    // multi-product catalog summary, not a single-product one.
    expect(generateReviewSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({ productName: "Verve Handmade", scope: "store" }),
    );
  });

  it("never pulls in another store's reviews when summarizing", async () => {
    await regenerateStoreAiSummary("store_1");
    // Only product_1's review (store_1) should have been counted — product_2's review
    // (store_2) must never contribute, even though both exist in the same fake table.
    expect(storeSummaries.get("store_1")?.reviewCountUsed).toBe(1);
  });

  it("aggregates approved reviews across every product in the store, not just one", async () => {
    products.push({ id: "product_1b", storeId: "store_1", name: "A Second Own Product" });
    reviews.push({ productId: "product_1b", rating: 4, title: "Also great", content: "Solid.", status: "APPROVED", deletedAt: null });

    await regenerateStoreAiSummary("store_1");

    // Both product_1's and product_1b's reviews belong to store_1 — a real multi-product
    // aggregation, never scoped to a single productId (regenerateStoreAiSummary's signature
    // takes only storeId; there is no productId parameter to narrow it).
    expect(storeSummaries.get("store_1")?.reviewCountUsed).toBe(2);
  });

  it("does not require or accept a productId — the function's own signature is storeId-only", () => {
    expect(regenerateStoreAiSummary.length).toBe(1);
  });

  it("excludes rejected reviews from the store summary review count", async () => {
    reviews.push({
      productId: "product_1",
      rating: 1,
      title: "Bad",
      content: "Spam content",
      status: "REJECTED",
      deletedAt: null,
    });

    await regenerateStoreAiSummary("store_1");
    expect(storeSummaries.get("store_1")?.reviewCountUsed).toBe(1);
  });

  it("propagates a real provider failure instead of persisting a fabricated summary", async () => {
    generateReviewSummaryMock.mockRejectedValueOnce(new Error("OPENAI_API_KEY is not configured."));

    await expect(regenerateStoreAiSummary("store_1")).rejects.toThrow("OPENAI_API_KEY is not configured.");
    expect(storeSummaries.has("store_1")).toBe(false);
  });
});

describe("maybeAutoRegenerateStoreAiSummary", () => {
  it("does nothing when the store has zero approved reviews", async () => {
    reviews = [];
    await maybeAutoRegenerateStoreAiSummary("store_1");
    expect(generateReviewSummaryMock).not.toHaveBeenCalled();
  });

  it("regenerates when no store summary exists yet, regardless of threshold", async () => {
    await maybeAutoRegenerateStoreAiSummary("store_1");
    expect(generateReviewSummaryMock).toHaveBeenCalledTimes(1);
    expect(storeSummaries.has("store_1")).toBe(true);
  });

  it("does not regenerate again before enough new approved reviews accumulate", async () => {
    await maybeAutoRegenerateStoreAiSummary("store_1"); // establishes reviewCountUsed = 1
    generateReviewSummaryMock.mockClear();

    await maybeAutoRegenerateStoreAiSummary("store_1"); // still just 1 approved review
    expect(generateReviewSummaryMock).not.toHaveBeenCalled();
  });

  it("regenerates once the configured threshold of new approved reviews is crossed", async () => {
    await maybeAutoRegenerateStoreAiSummary("store_1");
    generateReviewSummaryMock.mockClear();

    for (let i = 0; i < 5; i++) {
      reviews.push({
        productId: "product_1",
        rating: 5,
        title: null,
        content: `Another great review ${i}`,
        status: "APPROVED",
        deletedAt: null,
      });
    }

    await maybeAutoRegenerateStoreAiSummary("store_1");
    expect(generateReviewSummaryMock).toHaveBeenCalledTimes(1);
  });
});
