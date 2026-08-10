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

let products: FakeProduct[];
let reviews: FakeReview[];
let summaries: Map<string, { id: string; productId: string; summary: string; positives: string; negatives: string; recommendation: string; reviewCountUsed: number; provider: string; modelUsed: string; generatedAt: Date; updatedAt: Date }>;

vi.mock("../db.server", () => ({
  default: {
    store: {
      // "owner" => every permission (including canUseAI) is granted — this file's focus is
      // ownership scoping, not plan gating, which aiSummary.server.ts already has its own
      // assertPermission call for.
      findUnique: vi.fn(async () => ({ plan: "owner" })),
    },
    product: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = products.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id, name: product.name, storeId: product.storeId } : null;
      }),
    },
    review: {
      findMany: vi.fn(async ({ where }: { where: { productId: string; deletedAt: null; status: string } }) => {
        return reviews.filter((r) => r.productId === where.productId && r.deletedAt === null && r.status === where.status);
      }),
      count: vi.fn(async ({ where }: { where: { productId: string; deletedAt: null; status: string } }) => {
        return reviews.filter((r) => r.productId === where.productId && r.deletedAt === null && r.status === where.status).length;
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
  },
}));

vi.mock("./ai/provider.server", () => ({
  getAiProvider: () => ({
    name: "fake-provider",
    generateReviewSummary: vi.fn(async () => ({
      summary: "Customers love it.",
      positives: ["Great quality"],
      negatives: [],
      recommendation: "Anyone who wants a reliable product.",
      modelUsed: "fake-model",
    })),
  }),
}));

const { regenerateAiSummary } = await import("./aiSummary.server");

beforeEach(() => {
  products = [
    { id: "product_1", storeId: "store_1", name: "Own Product" },
    { id: "product_2", storeId: "store_2", name: "Other Store's Product" },
  ];
  reviews = [
    { productId: "product_1", rating: 5, title: "Great", content: "Loved it", status: "APPROVED", deletedAt: null },
    { productId: "product_2", rating: 5, title: "Great", content: "Loved it", status: "APPROVED", deletedAt: null },
  ];
  summaries = new Map();
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
