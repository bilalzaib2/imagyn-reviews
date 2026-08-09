// Exercises the actual cursor-pagination/upsert logic against a fake Shopify Admin GraphQL
// client and a fake in-memory Product table — no real network call, no real database
// connection, so this is safe to run anywhere (including against this repo's
// production-designated DATABASE_URL) without touching it. See db.server.ts's mock below.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

interface FakeProductRow {
  id: string;
  shopifyProductId: string;
  name: string;
  handle: string | null;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  featuredImage: string | null;
  description: string | null;
  slug: string | null;
  storeId: string;
  lastSyncedAt: Date | null;
}

// Keyed by shopifyProductId — mirrors the real table's `@unique` constraint on that column, so
// "does a second upsert of the same product create a duplicate" is answerable from this map's
// size, exactly like it would be from a real unique-constraint-backed table.
let fakeProductsByShopifyId: Map<string, FakeProductRow>;
let nextDbId: number;
let upsertCallCount: number;
let failingShopifyIds: Set<string>;

vi.mock("../db.server", () => ({
  default: {
    product: {
      upsert: vi.fn(async (args: { where: { shopifyProductId: string }; update: Partial<FakeProductRow>; create: Omit<FakeProductRow, "id"> }) => {
        upsertCallCount += 1;
        const shopifyProductId = args.where.shopifyProductId;

        if (failingShopifyIds.has(shopifyProductId)) {
          throw new Error(`Simulated upsert failure for ${shopifyProductId}`);
        }

        const existing = fakeProductsByShopifyId.get(shopifyProductId);
        const row: FakeProductRow = existing
          ? { ...existing, ...args.update }
          : { id: `db_${nextDbId++}`, ...args.create };

        fakeProductsByShopifyId.set(shopifyProductId, row);
        return row;
      }),
    },
  },
}));

// Imported after the mock above — Vitest hoists vi.mock calls to the top of the module
// regardless of source order, so this is purely for readability, not correctness.
const { syncAllProducts } = await import("./product.server");

interface FakeShopifyProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  description: string | null;
  featuredImage: { url: string } | null;
}

function buildCatalog(count: number): FakeShopifyProduct[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `gid://shopify/Product/${n}`,
      title: `Product ${n}`,
      handle: `product-${n}`,
      vendor: "Acme",
      productType: "Widget",
      status: "ACTIVE",
      description: null,
      featuredImage: null,
    };
  });
}

// Stands in for the real Shopify Admin GraphQL endpoint: serves productsCount, then serves the
// products connection page-by-page exactly the way Shopify's cursor pagination actually works
// (an `after` cursor advances the window; `hasNextPage` is false only once every product has
// been served) — so a test exercising this against `syncAllProducts` is exercising the same
// pagination contract Shopify itself exposes, not a simplified stand-in for it.
function createFakeAdmin(options: {
  catalog: FakeShopifyProduct[];
  pageSize: number;
  throttleFirstPageRequest?: boolean;
}): AdminApiContext {
  const { catalog, pageSize } = options;
  let hasThrottledOnce = !options.throttleFirstPageRequest;

  const graphql = vi.fn(async (query: string, requestOptions?: { variables?: Record<string, unknown> }) => {
    if (query.includes("ImagynProductsCount")) {
      return {
        json: async () => ({
          data: { productsCount: { count: catalog.length } },
        }),
      };
    }

    if (!hasThrottledOnce) {
      hasThrottledOnce = true;
      return {
        json: async () => ({
          errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
          extensions: {
            cost: {
              requestedQueryCost: pageSize * 2,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 0, restoreRate: 1000 },
            },
          },
        }),
      };
    }

    const after = requestOptions?.variables?.after as string | null | undefined;
    const startIndex = after ? catalog.findIndex((product) => product.id === after) + 1 : 0;
    const pageNodes = catalog.slice(startIndex, startIndex + pageSize);
    const hasNextPage = startIndex + pageSize < catalog.length;
    const endCursor = pageNodes.length > 0 ? pageNodes[pageNodes.length - 1].id : null;

    return {
      json: async () => ({
        data: {
          products: {
            pageInfo: { hasNextPage, endCursor },
            nodes: pageNodes,
          },
        },
        extensions: {
          cost: {
            requestedQueryCost: pageSize * 2,
            throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 900, restoreRate: 1000 },
          },
        },
      }),
    };
  });

  return { graphql } as unknown as AdminApiContext;
}

function graphqlCallCount(admin: AdminApiContext): number {
  return (admin.graphql as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
}

beforeEach(() => {
  fakeProductsByShopifyId = new Map();
  nextDbId = 1;
  upsertCallCount = 0;
  failingShopifyIds = new Set();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("syncAllProducts — cursor pagination", () => {
  it("Case 1: 50 products fit in a single page and all 50 sync", async () => {
    const catalog = buildCatalog(50);
    const admin = createFakeAdmin({ catalog, pageSize: 250 });

    const result = await syncAllProducts(admin, "store_1", () => {});

    expect(result.synced).toBe(50);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(50);
    expect(fakeProductsByShopifyId.size).toBe(50);
    // productsCount + exactly one products page — no phantom second request for a
    // catalog smaller than the page size.
    expect(graphqlCallCount(admin)).toBe(2);
  });

  it("Case 2: exactly 250 products (== page size) is one page, not a phantom second page", async () => {
    const catalog = buildCatalog(250);
    const admin = createFakeAdmin({ catalog, pageSize: 250 });

    const result = await syncAllProducts(admin, "store_1", () => {});

    expect(result.synced).toBe(250);
    expect(fakeProductsByShopifyId.size).toBe(250);
    expect(graphqlCallCount(admin)).toBe(2);
  });

  it("Case 3: 251 products reaches a second page and syncs all 251", async () => {
    const catalog = buildCatalog(251);
    const admin = createFakeAdmin({ catalog, pageSize: 250 });

    const result = await syncAllProducts(admin, "store_1", () => {});

    expect(result.synced).toBe(251);
    expect(fakeProductsByShopifyId.size).toBe(251);
    // productsCount + page 1 (250) + page 2 (1)
    expect(graphqlCallCount(admin)).toBe(3);
  });

  it("Case 4: a 1,000-product catalog pages through every cursor with no duplicates or skips", async () => {
    const catalog = buildCatalog(1000);
    const admin = createFakeAdmin({ catalog, pageSize: 250 });
    const progressSnapshots: Array<{ synced: number; failed: number; total: number | null }> = [];

    const result = await syncAllProducts(admin, "store_1", (progress) => {
      progressSnapshots.push({ ...progress });
    });

    expect(result.synced).toBe(1000);
    expect(result.failed).toBe(0);
    expect(fakeProductsByShopifyId.size).toBe(1000);

    // Every Shopify product id from the source catalog made it into the database exactly once.
    for (const product of catalog) {
      expect(fakeProductsByShopifyId.has(product.id)).toBe(true);
    }

    // Progress was reported after every page and ends at the true total.
    expect(progressSnapshots[progressSnapshots.length - 1].synced).toBe(1000);
    // productsCount + 4 pages of 250
    expect(graphqlCallCount(admin)).toBe(5);
  });

  it("Case 5: one failing product does not abort the sync — the rest still sync", async () => {
    const catalog = buildCatalog(10);
    failingShopifyIds = new Set([catalog[4].id]);
    const admin = createFakeAdmin({ catalog, pageSize: 250 });

    const result = await syncAllProducts(admin, "store_1", () => {});

    expect(result.synced).toBe(9);
    expect(result.failed).toBe(1);
    expect(fakeProductsByShopifyId.size).toBe(9);
    expect(fakeProductsByShopifyId.has(catalog[4].id)).toBe(false);
  });

  it("Case 6: running the sync twice does not create duplicates", async () => {
    const catalog = buildCatalog(300);

    const first = await syncAllProducts(createFakeAdmin({ catalog, pageSize: 250 }), "store_1", () => {});
    expect(first.synced).toBe(300);
    expect(fakeProductsByShopifyId.size).toBe(300);

    const second = await syncAllProducts(createFakeAdmin({ catalog, pageSize: 250 }), "store_1", () => {});
    expect(second.synced).toBe(300);
    // Still 300 distinct rows, not 600 — every product from the second run matched an
    // existing row by shopifyProductId and updated it instead of creating a new one.
    expect(fakeProductsByShopifyId.size).toBe(300);
    expect(upsertCallCount).toBe(600);
  });

  it("re-syncing after a title/handle change updates the existing row instead of creating a duplicate", async () => {
    const catalog = buildCatalog(5);
    await syncAllProducts(createFakeAdmin({ catalog, pageSize: 250 }), "store_1", () => {});
    expect(fakeProductsByShopifyId.size).toBe(5);

    const renamedCatalog = catalog.map((product, index) =>
      index === 2 ? { ...product, title: "Renamed Product", handle: "renamed-product" } : product,
    );
    const second = await syncAllProducts(createFakeAdmin({ catalog: renamedCatalog, pageSize: 250 }), "store_1", () => {});

    expect(second.synced).toBe(5);
    // Identity was Shopify's product GID, not title/handle — still 5 rows, the renamed
    // product updated in place rather than creating a 6th.
    expect(fakeProductsByShopifyId.size).toBe(5);
    expect(fakeProductsByShopifyId.get(renamedCatalog[2].id)?.name).toBe("Renamed Product");
    expect(fakeProductsByShopifyId.get(renamedCatalog[2].id)?.handle).toBe("renamed-product");
  });

  it("retries through a THROTTLED response and still syncs the full catalog without loss or duplication", async () => {
    const catalog = buildCatalog(50);
    const admin = createFakeAdmin({ catalog, pageSize: 250, throttleFirstPageRequest: true });

    const result = await syncAllProducts(admin, "store_1", () => {});

    expect(result.synced).toBe(50);
    expect(result.failed).toBe(0);
    expect(fakeProductsByShopifyId.size).toBe(50);
  }, 10000);
});
