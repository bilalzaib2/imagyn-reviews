// Exercises reviewRequestService's storeId scoping/ownership checks against a fake in-memory
// Prisma client — no real database, no real email sent. Regression suite for the cross-tenant
// Review Requests leak found in the master feature audit: the list/picker reads must only ever
// return the caller's own store's rows, and every mutation must reject a request/product id
// belonging to a different store with the same generic "not found" a bogus id would produce.
// Every fixture here uses a non-zero delayDays so no path ever reaches "sending" status and
// calls the real email dispatch code — see resendRequest's own comment on why that matters.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeRequest {
  id: string;
  storeId: string;
  productId: string | null;
  name: string | null;
  email: string | null;
  orderNumber: string | null;
  customMessage: string | null;
  requestToken: string | null;
  tokenExpiresAt: Date | null;
  tokenUsedAt: Date | null;
  delayDays: number | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
  openedAt: Date | null;
  reviewedAt: Date | null;
  status: string;
  source: string;
  shopifyOrderId: string | null;
  shopifyLineItemId: string | null;
  sendAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeProduct {
  id: string;
  storeId: string;
  name: string;
}

interface FakeReview {
  storeId: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  deletedAt: Date | null;
}

interface FakeStoreRow {
  id: string;
  name: string;
  domain: string | null;
}

let requests: FakeRequest[];
let products: FakeProduct[];
let reviews: FakeReview[];
let stores: FakeStoreRow[];
let nextId: number;

function seedRequest(overrides: Partial<FakeRequest> & { id: string; storeId: string }): FakeRequest {
  const request: FakeRequest = {
    productId: null,
    name: "Jordan Avery",
    email: "jordan@example.com",
    orderNumber: null,
    customMessage: null,
    requestToken: `token_${overrides.id}`,
    tokenExpiresAt: null,
    tokenUsedAt: null,
    delayDays: 3,
    scheduledFor: new Date(),
    sentAt: null,
    openedAt: null,
    reviewedAt: null,
    status: "scheduled",
    source: "manual",
    shopifyOrderId: null,
    shopifyLineItemId: null,
    sendAttempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  requests.push(request);
  return request;
}

function seedProduct(overrides: Partial<FakeProduct> & { id: string; storeId: string }): FakeProduct {
  const product: FakeProduct = { name: "Test Product", ...overrides };
  products.push(product);
  return product;
}

function withInclude(row: FakeRequest) {
  const store = stores.find((s) => s.id === row.storeId) ?? { id: row.storeId, name: "Store", domain: null };
  const product = row.productId ? products.find((p) => p.id === row.productId) ?? null : null;
  return {
    ...row,
    store,
    product: product ? { id: product.id, name: product.name, featuredImage: null } : null,
  };
}

vi.mock("../db.server", () => ({
  default: {
    product: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = products.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id, storeId: product.storeId, name: product.name } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        return products
          .filter((p) => p.storeId === where.storeId)
          .map((p) => ({ id: p.id, name: p.name, storeId: p.storeId }));
      }),
    },
    review: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string; deletedAt: null; reviewerEmail: { not: null } } }) => {
        return reviews
          .filter((r) => r.storeId === where.storeId && r.deletedAt === null && r.reviewerEmail !== null)
          .map((r) => ({ reviewerName: r.reviewerName, reviewerEmail: r.reviewerEmail }));
      }),
    },
    reviewRequest: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        return requests.find((r) => r.id === where.id && r.storeId === where.storeId) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        return requests.filter((r) => r.storeId === where.storeId).map(withInclude);
      }),
      count: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        return requests.filter((r) => r.storeId === where.storeId).length;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRequest> }) => {
        const row = requests.find((r) => r.id === where.id);
        if (!row) throw new Error("Row not found");
        Object.assign(row, data);
        return withInclude(row);
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeRequest> & { storeId: string } }) => {
        const row = seedRequest({
          ...data,
          id: `req_${nextId++}`,
        });
        return withInclude(row);
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        requests = requests.filter((r) => r.id !== where.id);
        return {};
      }),
    },
  },
}));

const { reviewRequestService } = await import("./review-request.server");

beforeEach(() => {
  requests = [];
  products = [];
  reviews = [];
  stores = [
    { id: "store_1", name: "Store One", domain: "store-one.myshopify.com" },
    { id: "store_2", name: "Store Two", domain: "store-two.myshopify.com" },
  ];
  nextId = 1;
  seedProduct({ id: "product_1", storeId: "store_1" });
  seedProduct({ id: "product_2", storeId: "store_2" });
});

describe("listRequests — storeId scoping", () => {
  it("only returns the requesting store's own requests", async () => {
    seedRequest({ id: "req_1", storeId: "store_1" });
    seedRequest({ id: "req_2", storeId: "store_2" });

    const result = await reviewRequestService.listRequests("store_1", {});

    expect(result.totalCount).toBe(1);
    expect(result.requests.map((r) => r.id)).toEqual(["req_1"]);
  });
});

describe("listProducts / listCustomers — storeId scoping", () => {
  it("listProducts never returns another store's products", async () => {
    const products1 = await reviewRequestService.listProducts("store_1");
    expect(products1.map((p) => p.id)).toEqual(["product_1"]);
  });

  it("listCustomers never leaks another store's customer names/emails", async () => {
    reviews.push({ storeId: "store_1", reviewerName: "Own Customer", reviewerEmail: "own@example.com", deletedAt: null });
    reviews.push({ storeId: "store_2", reviewerName: "Other Merchant's Customer", reviewerEmail: "other@example.com", deletedAt: null });

    const customers = await reviewRequestService.listCustomers("store_1");

    expect(customers).toHaveLength(1);
    expect(customers[0].reviewerEmail).toBe("own@example.com");
  });
});

describe("createRequest — product ownership", () => {
  it("rejects a productId that belongs to a different store", async () => {
    await expect(
      reviewRequestService.createRequest("store_1", {
        productId: "product_2",
        email: "jordan@example.com",
        name: "Jordan",
        delayDays: 3,
      }),
    ).rejects.toThrow("Product not found.");
    expect(requests).toHaveLength(0);
  });

  it("succeeds for a product that belongs to the caller's store", async () => {
    const { request } = await reviewRequestService.createRequest("store_1", {
      productId: "product_1",
      email: "jordan@example.com",
      name: "Jordan",
      delayDays: 3,
    });

    expect(request.store.id).toBe("store_1");
  });
});

describe("cross-tenant mutation isolation", () => {
  it("updateRequest rejects a request belonging to a different store", async () => {
    seedRequest({ id: "req_1", storeId: "store_2" });

    await expect(
      reviewRequestService.updateRequest("store_1", "req_1", { customMessage: "Hijacked" }),
    ).rejects.toThrow("Review request not found.");
    expect(requests.find((r) => r.id === "req_1")?.customMessage).toBeNull();
  });

  it("updateRequest rejects reassigning a request onto another store's product", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1" });

    await expect(
      reviewRequestService.updateRequest("store_1", "req_1", { productId: "product_2" }),
    ).rejects.toThrow("Product not found.");
    expect(requests.find((r) => r.id === "req_1")?.productId).toBe("product_1");
  });

  it("rescheduleRequest rejects a request belonging to a different store", async () => {
    seedRequest({ id: "req_1", storeId: "store_2", delayDays: 3, status: "scheduled" });

    await expect(reviewRequestService.rescheduleRequest("store_1", "req_1", 7)).rejects.toThrow(
      "Review request not found.",
    );
    expect(requests.find((r) => r.id === "req_1")?.delayDays).toBe(3);
  });

  it("resendRequest rejects a request belonging to a different store (and never touches its token)", async () => {
    const original = seedRequest({ id: "req_1", storeId: "store_2", delayDays: 3, requestToken: "original-token" });

    await expect(reviewRequestService.resendRequest("store_1", "req_1")).rejects.toThrow("Review request not found.");
    expect(requests.find((r) => r.id === "req_1")?.requestToken).toBe(original.requestToken);
  });

  it("resendRequest succeeds for the caller's own store and rotates the token", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", delayDays: 3, requestToken: "original-token" });

    const updated = await reviewRequestService.resendRequest("store_1", "req_1");

    expect(updated.requestToken).not.toBe("original-token");
    expect(updated.status).toBe("scheduled");
  });

  it("cancelRequest rejects a request belonging to a different store", async () => {
    seedRequest({ id: "req_1", storeId: "store_2", status: "scheduled" });

    await expect(reviewRequestService.cancelRequest("store_1", "req_1")).rejects.toThrow(
      "Review request not found.",
    );
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("scheduled");
  });

  it("deleteRequest rejects a request belonging to a different store", async () => {
    seedRequest({ id: "req_1", storeId: "store_2" });

    await expect(reviewRequestService.deleteRequest("store_1", "req_1")).rejects.toThrow(
      "Review request not found.",
    );
    expect(requests).toHaveLength(1);
  });

  it("deleteRequest succeeds for the caller's own store", async () => {
    seedRequest({ id: "req_1", storeId: "store_1" });

    await reviewRequestService.deleteRequest("store_1", "req_1");
    expect(requests).toHaveLength(0);
  });
});
