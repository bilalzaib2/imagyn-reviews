// Exercises getProductReviewCoverage — the Dashboard's "products needing attention" figure.
// Separate file/mock from product.server.test.ts (that one's db.server mock is scoped to
// syncAllProducts' upsert flow only) — no real database, no real network call.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProductRow {
  id: string;
  storeId: string;
  totalReviews: number;
}

let rows: FakeProductRow[];

vi.mock("../db.server", () => ({
  default: {
    product: {
      count: vi.fn(async (args: { where: { storeId: string; totalReviews?: number } }) => {
        return rows.filter(
          (row) =>
            row.storeId === args.where.storeId &&
            (args.where.totalReviews === undefined || row.totalReviews === args.where.totalReviews),
        ).length;
      }),
    },
  },
}));

const { getProductReviewCoverage } = await import("./product.server");

describe("getProductReviewCoverage", () => {
  beforeEach(() => {
    rows = [
      { id: "product_1", storeId: "store_1", totalReviews: 5 },
      { id: "product_2", storeId: "store_1", totalReviews: 0 },
      { id: "product_3", storeId: "store_1", totalReviews: 0 },
      { id: "product_4", storeId: "store_2", totalReviews: 0 },
    ];
    vi.clearAllMocks();
  });

  it("counts total products and products with zero reviews, scoped to the caller's own store", async () => {
    const result = await getProductReviewCoverage("store_1");
    expect(result).toEqual({ totalProducts: 3, withoutReviews: 2 });
  });

  it("never counts another store's products", async () => {
    const result = await getProductReviewCoverage("store_2");
    expect(result).toEqual({ totalProducts: 1, withoutReviews: 1 });
  });

  it("returns zeros for a store with no synced products yet", async () => {
    const result = await getProductReviewCoverage("store_3");
    expect(result).toEqual({ totalProducts: 0, withoutReviews: 0 });
  });
});
