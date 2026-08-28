// Exercises getProductForStore — the exact lookup app.products_.$id.tsx's loader uses to
// render the product detail page (see app.products.routing.test.ts for the route-naming half
// of this bug fix). Separate file/mock from product.server.test.ts (that one's db.server mock
// is scoped to syncAllProducts' upsert flow only) — no real database, no real network call.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProductRow {
  id: string;
  storeId: string;
  name: string;
}

let rows: FakeProductRow[];

vi.mock("../db.server", () => ({
  default: {
    product: {
      findFirst: vi.fn(async (args: { where: { id: string; storeId: string } }) => {
        return rows.find((row) => row.id === args.where.id && row.storeId === args.where.storeId) ?? null;
      }),
    },
  },
}));

const { getProductForStore } = await import("./product.server");

describe("getProductForStore", () => {
  beforeEach(() => {
    rows = [
      { id: "product_1", storeId: "store_1", name: "Brown Ceramic Plate" },
      { id: "product_2", storeId: "store_1", name: "Maroon Ceramic Plate" },
      { id: "product_3", storeId: "store_2", name: "A different store's product" },
    ];
    vi.clearAllMocks();
  });

  it("returns the exact product matching the given id, not just any product for the store", async () => {
    const result = await getProductForStore("product_2", "store_1");
    expect(result?.id).toBe("product_2");
    expect(result?.name).toBe("Maroon Ceramic Plate");
  });

  it("returns null when the id exists but belongs to a different store — a merchant can never load another store's product by guessing an id", async () => {
    const result = await getProductForStore("product_3", "store_1");
    expect(result).toBeNull();
  });

  it("returns null for an id that doesn't exist at all", async () => {
    const result = await getProductForStore("nonexistent", "store_1");
    expect(result).toBeNull();
  });
});
