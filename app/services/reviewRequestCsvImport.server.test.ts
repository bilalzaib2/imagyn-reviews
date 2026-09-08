// Exercises importReviewRequestsFromCsv end to end against a fake in-memory Prisma client —
// no real database, no real email sent (every row here uses a non-zero delayDays so no path
// ever reaches "sending" status and calls the real email dispatch code, same convention as
// review-request.server.test.ts). Exercises the REAL ProductMatcher.server.ts and
// reviewRequestService.createRequest/getExistingRequestContextBulk, so this catches integration
// bugs a header-parsing-only test would miss — only the prisma boundary is faked.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProduct {
  id: string;
  storeId: string;
  shopifyProductId: string | null;
  name: string;
  handle: string | null;
  slug: string | null;
}

interface FakeRequest {
  id: string;
  storeId: string;
  productId: string;
  email: string;
  status: string;
}

interface FakeReview {
  storeId: string;
  productId: string;
  reviewerEmail: string;
  deletedAt: Date | null;
}

let fakeProducts: FakeProduct[];
let fakeRequests: FakeRequest[];
let fakeReviews: FakeReview[];
let nextRequestId: number;

vi.mock("../db.server", () => ({
  default: {
    product: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) =>
        fakeProducts.filter((p) => p.storeId === where.storeId),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) => {
        const product = fakeProducts.find((p) => p.id === where.id && p.storeId === where.storeId);
        return product ? { id: product.id, storeId: product.storeId, name: product.name } : null;
      }),
    },
    review: {
      findMany: vi.fn(
        async ({ where }: { where: { storeId: string; productId: { in: string[] }; reviewerEmail: { in: string[] }; deletedAt: null } }) =>
          fakeReviews
            .filter(
              (r) =>
                r.storeId === where.storeId &&
                where.productId.in.includes(r.productId) &&
                where.reviewerEmail.in.includes(r.reviewerEmail) &&
                r.deletedAt === null,
            )
            .map((r) => ({ reviewerEmail: r.reviewerEmail, productId: r.productId })),
      ),
    },
    reviewRequest: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { storeId: string; productId: { in: string[] }; email: { in: string[] }; status: { in: string[] } };
        }) =>
          fakeRequests
            .filter(
              (r) =>
                r.storeId === where.storeId &&
                where.productId.in.includes(r.productId) &&
                where.email.in.includes(r.email) &&
                where.status.in.includes(r.status),
            )
            .map((r) => ({ email: r.email, productId: r.productId })),
      ),
      create: vi.fn(async ({ data }: { data: { storeId: string; productId: string; email: string; delayDays: number; status?: string } }) => {
        const request: FakeRequest = {
          id: `req_${nextRequestId++}`,
          storeId: data.storeId,
          productId: data.productId,
          email: data.email,
          status: data.delayDays === 0 ? "sending" : "scheduled",
        };
        fakeRequests.push(request);
        return { ...request, store: { id: data.storeId, name: "Store", domain: null }, product: { id: data.productId, name: "Product", featuredImage: null } };
      }),
    },
  },
}));

const { importReviewRequestsFromCsv } = await import("./reviewRequestCsvImport.server");

function seedProduct(overrides: Partial<FakeProduct>): FakeProduct {
  const product: FakeProduct = {
    id: overrides.id ?? "db_product_1",
    storeId: overrides.storeId ?? "store_1",
    shopifyProductId: overrides.shopifyProductId ?? null,
    name: overrides.name ?? "Test Product",
    handle: overrides.handle ?? null,
    slug: overrides.slug ?? null,
  };
  fakeProducts.push(product);
  return product;
}

beforeEach(() => {
  fakeProducts = [];
  fakeRequests = [];
  fakeReviews = [];
  nextRequestId = 1;
});

const HEADER = "email,name,product_handle,delay_days\n";

describe("importReviewRequestsFromCsv", () => {
  it("creates a request for a well-formed row, matched by product handle", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });

    const csv = HEADER + "jane@example.com,Jane Doe,blue-widget,5\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(fakeRequests).toHaveLength(1);
    expect(fakeRequests[0].productId).toBe("db_1");
  });

  it("falls back to the per-file default delay when a row has no delay_days value", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });

    const csv = "email,name,product_handle\njane@example.com,Jane Doe,blue-widget\n";
    await importReviewRequestsFromCsv("store_1", csv, null, 7);

    expect(fakeRequests).toHaveLength(1);
  });

  it("matches by product name when only a title column is given", async () => {
    seedProduct({ id: "db_1", name: "Blue Widget" });

    const csv = "email,name,product,delay_days\njane@example.com,Jane Doe,Blue Widget,3\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(1);
    expect(fakeRequests[0].productId).toBe("db_1");
  });

  it("reports a row with no email as an error, without aborting the rest of the file", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });

    const csv = HEADER + ",Jane Doe,blue-widget,3\n" + "john@example.com,John Roe,blue-widget,3\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/Missing email/);
  });

  it("reports a row whose product doesn't match anything as a missing product, not a crash", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });

    const csv = HEADER + "jane@example.com,Jane Doe,nonexistent-handle,3\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(0);
    expect(result.missingProducts).toHaveLength(1);
  });

  it("skips a row whose (email, product) pair already has a pending request", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });
    fakeRequests.push({ id: "existing", storeId: "store_1", productId: "db_1", email: "jane@example.com", status: "scheduled" });

    const csv = HEADER + "jane@example.com,Jane Doe,blue-widget,3\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
  });

  it("skips a row whose (email, product) pair already has a real review", async () => {
    seedProduct({ id: "db_1", handle: "blue-widget" });
    fakeReviews.push({ storeId: "store_1", productId: "db_1", reviewerEmail: "jane@example.com", deletedAt: null });

    const csv = HEADER + "jane@example.com,Jane Doe,blue-widget,3\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
  });

  it("rejects a file with no data rows", async () => {
    const result = await importReviewRequestsFromCsv("store_1", "email,name,product_handle\n", null, 3);
    expect(result.errors[0].reason).toMatch(/no data rows/);
  });

  it("rejects a file missing both an email column and a product column", async () => {
    const result = await importReviewRequestsFromCsv("store_1", "name,notes\nJane,hello\n", null, 3);
    expect(result.errors[0].reason).toMatch(/email column/);
  });

  it("never lets a row from one store match another store's product", async () => {
    seedProduct({ id: "db_other", storeId: "store_2", handle: "blue-widget" });

    const csv = HEADER + "jane@example.com,Jane Doe,blue-widget,3\n";
    const result = await importReviewRequestsFromCsv("store_1", csv, null, 3);

    expect(result.created).toBe(0);
    expect(result.missingProducts).toHaveLength(1);
  });
});
