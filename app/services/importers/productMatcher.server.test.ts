// Exercises ProductMatcher's full priority chain against an in-memory product catalog — no
// real database, no real Shopify Admin API. getProducts is mocked (the only DB call
// ProductMatcher.forStore makes); toProductGid is kept real via importOriginal, since its own
// normalization correctness is exactly what several of these tests depend on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@prisma/client";

let fakeProducts: Product[] = [];

vi.mock("../product.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../product.server")>();
  return {
    ...actual,
    getProducts: vi.fn(async () => fakeProducts),
  };
});

const { ProductMatcher } = await import("./productMatcher.server");

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? "db_1",
    storeId: "store_1",
    shopifyProductId: overrides.shopifyProductId ?? null,
    name: overrides.name ?? "Untitled Product",
    handle: overrides.handle ?? null,
    vendor: null,
    productType: null,
    status: "ACTIVE",
    featuredImage: null,
    slug: overrides.slug ?? null,
    description: null,
    averageRating: 0,
    totalReviews: 0,
    rating5Count: 0,
    rating4Count: 0,
    rating3Count: 0,
    rating2Count: 0,
    rating1Count: 0,
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Product;
}

beforeEach(() => {
  fakeProducts = [];
});

describe("ProductMatcher", () => {
  it("matches by Shopify Product ID, normalizing a bare numeric id to GID form", async () => {
    fakeProducts = [
      makeProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/8031152537913", name: "Grace S1560" }),
    ];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ productId: "8031152537913" }, null);

    expect(result.productId).toBe("db_1");
    expect(result.tier).toBe("shopify_product_id");
  });

  it("matches by Shopify Product ID when the CSV already provides a full GID", async () => {
    fakeProducts = [makeProduct({ id: "db_1", shopifyProductId: "gid://shopify/Product/999", name: "Test" })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ productId: "gid://shopify/Product/999" }, null);

    expect(result.productId).toBe("db_1");
    expect(result.tier).toBe("shopify_product_id");
  });

  it("falls through to handle matching when product ID doesn't match anything", async () => {
    fakeProducts = [
      makeProduct({ id: "db_2", shopifyProductId: "gid://shopify/Product/1", handle: "grace-w104-embroidered-3pc" }),
    ];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match(
      { productId: "9999999999999", handle: "grace-w104-embroidered-3pc" },
      null,
    );

    expect(result.productId).toBe("db_2");
    expect(result.tier).toBe("handle");
  });

  it("handle matching is case-insensitive and trims whitespace", async () => {
    fakeProducts = [makeProduct({ id: "db_3", handle: "grace-s1560-embroidered-2pc-lawn-dress" })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ handle: "  Grace-S1560-Embroidered-2PC-Lawn-Dress  " }, null);

    expect(result.productId).toBe("db_3");
    expect(result.tier).toBe("handle");
  });

  it("matches by product URL, extracting the handle from a /products/<handle> path", async () => {
    fakeProducts = [makeProduct({ id: "db_4", handle: "grace-s1560-embroidered-2pc-lawn-dress" })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match(
      { url: "https://gracestore.pk/products/grace-s1560-embroidered-2pc-lawn-dress?variant=123" },
      null,
    );

    expect(result.productId).toBe("db_4");
    expect(result.tier).toBe("url");
  });

  it("matches by slug when handle doesn't resolve", async () => {
    fakeProducts = [makeProduct({ id: "db_5", handle: "different-handle", slug: "grace-slug-only" })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ handle: "no-such-handle", slug: "grace-slug-only" }, null);

    expect(result.productId).toBe("db_5");
    expect(result.tier).toBe("slug");
  });

  it("matches by exact normalized title when no structured identifier is present", async () => {
    fakeProducts = [makeProduct({ id: "db_6", name: "Grace S1560-Embroidered 2pc Lawn Dress." })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ title: "grace s1560-embroidered 2pc lawn dress." }, null);

    expect(result.productId).toBe("db_6");
    expect(["exact_title", "normalized_title"]).toContain(result.tier);
  });

  it("normalized title matching tolerates punctuation, casing, and extra whitespace", async () => {
    fakeProducts = [makeProduct({ id: "db_7", name: "Grace S1560 - Embroidered 2pc Lawn Dress." })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ title: "grace s1560   embroidered   2pc lawn dress" }, null);

    expect(result.productId).toBe("db_7");
    expect(result.tier).toBe("normalized_title");
  });

  it("falls back to fuzzy title matching above the confidence threshold", async () => {
    fakeProducts = [makeProduct({ id: "db_8", name: "Grace S1560 Embroidered 2pc Lawn Dress With Chiffon Dupatta" })];
    const matcher = await ProductMatcher.forStore("store_1");

    // Missing "With Chiffon Dupatta" and reordered — not an exact or normalized match, but
    // shares enough tokens to clear the 0.75 similarity floor.
    const result = await matcher.match({ title: "Embroidered Grace S1560 2pc Lawn Dress" }, null);

    expect(result.productId).toBe("db_8");
    expect(result.tier).toBe("fuzzy");
  });

  it("never fuzzy-matches below the safe confidence threshold — returns unmatched instead of guessing", async () => {
    fakeProducts = [
      makeProduct({ id: "db_9", name: "Grace S1560 Embroidered 2pc Lawn Dress" }),
      makeProduct({ id: "db_10", name: "Completely Unrelated Product Name Entirely" }),
    ];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({ title: "Some other dress that shares almost nothing" }, null);

    expect(result.productId).toBeNull();
    expect(result.tier).toBeNull();
  });

  it("returns unmatched when no identifier at all is provided", async () => {
    fakeProducts = [makeProduct({ id: "db_11", name: "Anything" })];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match({}, null);

    expect(result.productId).toBeNull();
    expect(result.tier).toBeNull();
  });

  it("respects tier priority — a Shopify Product ID match wins even when a title would also match a different product", async () => {
    fakeProducts = [
      makeProduct({ id: "db_by_id", shopifyProductId: "gid://shopify/Product/42", name: "Wrong Name On Purpose" }),
      makeProduct({ id: "db_by_title", name: "Grace S1560 Embroidered 2pc Lawn Dress" }),
    ];
    const matcher = await ProductMatcher.forStore("store_1");

    const result = await matcher.match(
      { productId: "42", title: "Grace S1560 Embroidered 2pc Lawn Dress" },
      null,
    );

    expect(result.productId).toBe("db_by_id");
    expect(result.tier).toBe("shopify_product_id");
  });
});
