// Exercises searchShopifyOrders' real query-building, error-classification, and local-catalog
// matching logic against a fake `admin.graphql` and a fake Prisma client — no real Shopify API
// call, no real database. This is the data layer behind the "Send Request → Shopify Orders"
// picker, so its search-syntax translation and Protected Customer Data error classification are
// worth locking down directly rather than only exercising them incidentally through a route test.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProduct {
  id: string;
  storeId: string;
  name: string;
  shopifyProductId: string;
  featuredImage: string | null;
}

let fakeProducts: FakeProduct[];

vi.mock("../db.server", () => ({
  default: {
    product: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string; shopifyProductId: { in: string[] } } }) =>
        fakeProducts.filter(
          (p) => p.storeId === where.storeId && where.shopifyProductId.in.includes(p.shopifyProductId),
        ),
      ),
    },
  },
}));

const { searchShopifyOrders, ProtectedCustomerDataError } = await import("./shopifyOrders.server");

function ordersResponse(edges: unknown[], pageInfo = { hasNextPage: false, endCursor: null }) {
  return { data: { orders: { edges, pageInfo } } };
}

function orderNode(overrides: Partial<{
  id: string;
  name: string;
  customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
  lineItems: Array<{ id: string; title: string; quantity: number; productId: string | null }>;
}> = {}) {
  const lineItems = overrides.lineItems ?? [{ id: "gid://shopify/LineItem/1", title: "Blue Widget", quantity: 1, productId: "gid://shopify/Product/1" }];

  return {
    cursor: "cursor1",
    node: {
      id: overrides.id ?? "gid://shopify/Order/100",
      name: overrides.name ?? "#1001",
      createdAt: "2026-01-01T00:00:00Z",
      displayFulfillmentStatus: "FULFILLED",
      displayFinancialStatus: "PAID",
      customer: overrides.customer !== undefined ? overrides.customer : { firstName: "Jane", lastName: "Doe", email: "jane@example.com" },
      lineItems: {
        edges: lineItems.map((item) => ({
          node: { id: item.id, title: item.title, quantity: item.quantity, product: item.productId ? { id: item.productId } : null },
        })),
      },
    },
  };
}

function fakeAdmin(responses: unknown[]) {
  let call = 0;
  return {
    graphql: vi.fn(async () => {
      const body = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return { json: async () => body };
    }),
  } as unknown as import("@shopify/shopify-app-react-router/server").AdminApiContext;
}

beforeEach(() => {
  fakeProducts = [];
});

describe("searchShopifyOrders — order mapping", () => {
  it("maps a real order into the summary shape, converting GIDs to legacy ids", async () => {
    const admin = fakeAdmin([ordersResponse([orderNode()])]);
    const result = await searchShopifyOrders(admin, "store_1");

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      shopifyOrderId: "100",
      orderNumber: "#1001",
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
    });
    expect(result.orders[0].lineItems[0].shopifyLineItemId).toBe("1");
    expect(result.orders[0].lineItems[0].shopifyProductId).toBe("1");
  });

  it("matches a line item's product against the local catalog when it's already synced", async () => {
    fakeProducts.push({ id: "local_1", storeId: "store_1", name: "Blue Widget", shopifyProductId: "gid://shopify/Product/1", featuredImage: "img.png" });
    const admin = fakeAdmin([ordersResponse([orderNode()])]);

    const result = await searchShopifyOrders(admin, "store_1");

    expect(result.orders[0].lineItems[0]).toMatchObject({
      localProductId: "local_1",
      localProductName: "Blue Widget",
      localProductImage: "img.png",
    });
  });

  it("leaves local product fields null when the line item's product isn't synced locally", async () => {
    const admin = fakeAdmin([ordersResponse([orderNode()])]);
    const result = await searchShopifyOrders(admin, "store_1");

    expect(result.orders[0].lineItems[0].localProductId).toBeNull();
  });

  it("never lets a match leak across stores", async () => {
    fakeProducts.push({ id: "other_store", storeId: "store_2", name: "Blue Widget", shopifyProductId: "gid://shopify/Product/1", featuredImage: null });
    const admin = fakeAdmin([ordersResponse([orderNode()])]);

    const result = await searchShopifyOrders(admin, "store_1");
    expect(result.orders[0].lineItems[0].localProductId).toBeNull();
  });

  it("handles an order with no customer (redacted or guest) without crashing", async () => {
    const admin = fakeAdmin([ordersResponse([orderNode({ customer: null })])]);
    const result = await searchShopifyOrders(admin, "store_1");

    expect(result.orders[0].customerName).toBeNull();
    expect(result.orders[0].customerEmail).toBeNull();
  });
});

describe("searchShopifyOrders — real Shopify search-syntax translation", () => {
  it("translates a #-prefixed search into a name: clause", async () => {
    const admin = fakeAdmin([ordersResponse([])]);
    await searchShopifyOrders(admin, "store_1", { search: "#1001" });

    const [, variables] = (admin.graphql as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(variables.variables.query).toBe("name:#1001");
  });

  it("translates a bare number into an order-name search", async () => {
    const admin = fakeAdmin([ordersResponse([])]);
    await searchShopifyOrders(admin, "store_1", { search: "1001" });

    const [, variables] = (admin.graphql as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(variables.variables.query).toBe("name:#1001");
  });

  it("translates an email-shaped search into an email: clause", async () => {
    const admin = fakeAdmin([ordersResponse([])]);
    await searchShopifyOrders(admin, "store_1", { search: "jane@example.com" });

    const [, variables] = (admin.graphql as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(variables.variables.query).toBe("email:jane@example.com");
  });

  it("combines a plain-text search with fulfillment-status and date filters", async () => {
    const admin = fakeAdmin([ordersResponse([])]);
    await searchShopifyOrders(admin, "store_1", {
      search: "Jane",
      fulfillmentStatus: "fulfilled",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });

    const [, variables] = (admin.graphql as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(variables.variables.query).toBe("Jane AND fulfillment_status:fulfilled AND created_at:>=2026-01-01 AND created_at:<=2026-01-31");
  });

  it("passes an undefined query when no filters are given at all", async () => {
    const admin = fakeAdmin([ordersResponse([])]);
    await searchShopifyOrders(admin, "store_1");

    const [, variables] = (admin.graphql as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(variables.variables.query).toBeUndefined();
  });
});

describe("searchShopifyOrders — error handling", () => {
  it("throws ProtectedCustomerDataError with a real explanation when Shopify denies Customer access", async () => {
    const admin = fakeAdmin([
      { errors: [{ message: "This app is not approved to access the Customer object.", extensions: { code: "ACCESS_DENIED" } }] },
    ]);

    await expect(searchShopifyOrders(admin, "store_1")).rejects.toThrow(ProtectedCustomerDataError);
  });

  it("retries once on a throttled response, then succeeds", async () => {
    const admin = fakeAdmin([{ errors: [{ message: "Throttled" }] }, ordersResponse([orderNode()])]);

    const result = await searchShopifyOrders(admin, "store_1");
    expect(result.orders).toHaveLength(1);
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });

  it("throws a real error for a non-throttle, non-protected-data GraphQL error", async () => {
    const admin = fakeAdmin([{ errors: [{ message: "Something else went wrong" }] }]);
    await expect(searchShopifyOrders(admin, "store_1")).rejects.toThrow("Something else went wrong");
  });

  it("throws when Shopify returns no data and no errors", async () => {
    const admin = fakeAdmin([{}]);
    await expect(searchShopifyOrders(admin, "store_1")).rejects.toThrow("did not return any data");
  });
});
