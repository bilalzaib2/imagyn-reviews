// Exercises reviewRequestService's storeId scoping/ownership checks against a fake in-memory
// Prisma client — no real database, no real email sent. Regression suite for the cross-tenant
// Review Requests leak found in the master feature audit: the list/picker reads must only ever
// return the caller's own store's rows, and every mutation must reject a request/product id
// belonging to a different store with the same generic "not found" a bogus id would produce.
// Every fixture here uses a non-zero delayDays so no path ever reaches "sending" status and
// calls the real email dispatch code — see resendRequest's own comment on why that matters.
import { Prisma } from "@prisma/client";
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
  reminder1SentAt: Date | null;
  reminderFinalSentAt: Date | null;
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
  productId?: string;
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
let suppressions: Array<{ storeId: string; email: string }>;
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
    reminder1SentAt: null,
    reminderFinalSentAt: null,
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

// Generalized to match either lookup shape real callers use: {id, storeId} (ownership checks)
// or {storeId, productId, email, status: {in: [...]}} (getExistingRequestContext's duplicate
// check) — one implementation instead of branching per call site.
function matchesInOrExact(value: unknown, clause: unknown): boolean {
  if (clause === undefined) return true;
  if (typeof clause === "object" && clause !== null && "in" in clause) {
    return (clause as { in: unknown[] }).in.includes(value);
  }
  if (typeof clause === "object" && clause !== null && "not" in clause) {
    return value !== (clause as { not: unknown }).not;
  }
  return value === clause;
}

function matchesRequestWhere(row: FakeRequest, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.storeId !== undefined && row.storeId !== where.storeId) return false;
  if (!matchesInOrExact(row.productId, where.productId)) return false;
  if (!matchesInOrExact(row.email, where.email)) return false;
  if (where.status !== undefined) {
    const status = where.status as string | { in?: string[] };
    if (typeof status === "string" && row.status !== status) return false;
    if (typeof status === "object" && status.in && !status.in.includes(row.status)) return false;
  }
  if (where.updatedAt !== undefined) {
    const clause = where.updatedAt as { lt?: Date };
    if (clause.lt && !(row.updatedAt < clause.lt)) return false;
  }
  return true;
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
      // Two distinct callers, two distinct `where` shapes: listCustomers's
      // reviewerEmail: {not: null} (no productId filter at all) vs.
      // getExistingRequestContextBulk's productId: {in: [...]}, reviewerEmail: {in: [...]}.
      // Branching on which shape was actually passed, rather than trying to force one matcher
      // to cover both operators, keeps each branch exactly as narrow as its real caller.
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const reviewerEmailClause = where.reviewerEmail as { not?: null; in?: string[] } | undefined;

        if (reviewerEmailClause && "not" in reviewerEmailClause) {
          return reviews
            .filter((r) => r.storeId === where.storeId && r.deletedAt === null && r.reviewerEmail !== null)
            .map((r) => ({ reviewerName: r.reviewerName, reviewerEmail: r.reviewerEmail }));
        }

        const productIds = (where.productId as { in?: string[] } | undefined)?.in;
        const emails = reviewerEmailClause?.in;

        return reviews
          .filter(
            (r) =>
              r.storeId === where.storeId &&
              r.deletedAt === null &&
              (!productIds || (r.productId !== undefined && productIds.includes(r.productId))) &&
              (!emails || (r.reviewerEmail !== null && emails.includes(r.reviewerEmail))),
          )
          .map((r) => ({ reviewerEmail: r.reviewerEmail, productId: r.productId }));
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = reviews.find(
          (r) =>
            r.storeId === where.storeId &&
            (where.productId === undefined || r.productId === where.productId) &&
            (where.reviewerEmail === undefined || r.reviewerEmail === where.reviewerEmail) &&
            r.deletedAt === null,
        );
        return row ? { id: "review_fake" } : null;
      }),
    },
    reviewRequest: {
      // Always returns the withInclude shape (store/product populated), matching real Prisma's
      // behavior whenever `include` is passed — several call sites (cancelRequest's
      // already-cancelled no-op, resendRequest) feed this straight into mapRequestRecord,
      // which expects store/product to be present.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const row = requests.find((r) => matchesRequestWhere(r, where));
        return row ? withInclude(row) : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; requestToken?: string } }) => {
        const row = requests.find((r) =>
          where.id !== undefined ? r.id === where.id : r.requestToken === where.requestToken,
        );
        return row ? withInclude(row) : null;
      }),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: Record<string, unknown>;
          orderBy?: Array<Record<string, "asc" | "desc">>;
          take?: number;
        }) => {
          let rows = requests.filter((r) => matchesRequestWhere(r, where));
          if (orderBy && orderBy.length > 0) {
            const [primary] = orderBy;
            const [field, dir] = Object.entries(primary)[0];
            rows.sort((a, b) => {
              const aValue = (a as unknown as Record<string, unknown>)[field];
              const bValue = (b as unknown as Record<string, unknown>)[field];
              if (aValue === bValue) return 0;
              if (aValue === null || aValue === undefined) return 1;
              if (bValue === null || bValue === undefined) return -1;
              const comparison = aValue > bValue ? 1 : -1;
              return dir === "asc" ? comparison : -comparison;
            });
          }
          if (typeof take === "number") {
            rows = rows.slice(0, take);
          }
          return rows.map(withInclude);
        },
      ),
      count: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        return requests.filter((r) => r.storeId === where.storeId).length;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<FakeRequest> }) => {
        const targets = requests.filter((r) => where.id.in.includes(r.id));
        targets.forEach((row) => Object.assign(row, data));
        return { count: targets.length };
      }),
      groupBy: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        const counts = new Map<string, number>();
        for (const row of requests) {
          if (row.storeId !== where.storeId) continue;
          counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } }));
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRequest> }) => {
        const row = requests.find((r) => r.id === where.id);
        if (!row) throw new Error("Row not found");
        Object.assign(row, data);
        return withInclude(row);
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeRequest> & { storeId: string } }) => {
        // Real Prisma's @@unique([shopifyOrderId, productId]) constraint, simulated — only
        // fires for order-triggered rows (both fields non-null), matching the actual schema
        // comment ("manual requests are exempt"). createManyFromOrders/createFromOrder's own
        // duplicate handling depends on a genuine P2002 being thrown here, not just a plain
        // Error, since that's the exact error shape their catch blocks check for.
        if (
          data.shopifyOrderId &&
          data.productId &&
          requests.some((r) => r.shopifyOrderId === data.shopifyOrderId && r.productId === data.productId)
        ) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }

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
    // Only exercised by the sendNow test below (every other path here has nextDelay > 0, so
    // dispatchRequestEmail is never actually invoked) — returns null so
    // emailTemplateService.getActiveContent falls back to its hardcoded defaults, exactly like
    // an un-configured store in production.
    emailTemplate: {
      findFirst: vi.fn(async () => null),
    },
    // Backs emailSuppressionService.isSuppressed — real integration (not a mocked service),
    // same convention as emailTemplate above. Empty by default; individual tests seed
    // `suppressions` to exercise the suppressed path.
    emailSuppression: {
      findUnique: vi.fn(
        async ({ where }: { where: { storeId_email: { storeId: string; email: string } } }) => {
          const { storeId, email } = where.storeId_email;
          return suppressions.find((s) => s.storeId === storeId && s.email === email) ?? null;
        },
      ),
    },
    // Backs recordDataAccess (auditLog.server.ts), called by purgeStaleContactInfo — a bare
    // resolved value is enough here since the audit write itself is covered directly by
    // auditLog.server.test.ts, not re-tested per call site.
    auditLog: {
      create: vi.fn(async () => ({})),
    },
  },
}));

// Avoids a real Resend API call (and the ~2s of retry/sleep a genuine failure would take) for
// the one test below that reaches dispatchRequestEmail — resolves instantly, like a
// successfully-configured provider would.
vi.mock("./notifications/provider.server", () => ({
  getEmailProvider: () => ({
    name: "fake",
    sendEmail: vi.fn(async () => ({ id: "fake-message-id" })),
  }),
}));

process.env.SHOPIFY_API_SECRET ||= "test-secret-for-unsubscribe-hmac";

const { reviewRequestService, dispatchRequestEmail, dispatchReminderEmail, RequestNotEligibleError } = await import(
  "./review-request.server"
);

beforeEach(() => {
  requests = [];
  suppressions = [];
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

describe("listRequests — sorting", () => {
  it("defaults to createdAt descending when no sort is given", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", createdAt: new Date("2026-01-01") });
    seedRequest({ id: "req_2", storeId: "store_1", createdAt: new Date("2026-03-01") });
    seedRequest({ id: "req_3", storeId: "store_1", createdAt: new Date("2026-02-01") });

    const result = await reviewRequestService.listRequests("store_1", {});

    expect(result.requests.map((r) => r.id)).toEqual(["req_2", "req_3", "req_1"]);
  });

  it("sorts by name ascending when requested", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", name: "Charlie" });
    seedRequest({ id: "req_2", storeId: "store_1", name: "Alice" });
    seedRequest({ id: "req_3", storeId: "store_1", name: "Bob" });

    const result = await reviewRequestService.listRequests("store_1", { sortBy: "name", sortDir: "asc" });

    expect(result.requests.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("sorts by scheduledFor ascending (soonest first)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", scheduledFor: new Date("2026-06-01") });
    seedRequest({ id: "req_2", storeId: "store_1", scheduledFor: new Date("2026-01-01") });

    const result = await reviewRequestService.listRequests("store_1", { sortBy: "scheduledFor", sortDir: "asc" });

    expect(result.requests.map((r) => r.id)).toEqual(["req_2", "req_1"]);
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

describe("getRequestStats — Dashboard's Review Requests figures", () => {
  it("buckets every real status into sent/completed/scheduled/pending, scoped to the caller's own store", async () => {
    seedRequest({ id: "req_scheduled", storeId: "store_1", status: "scheduled" });
    seedRequest({ id: "req_pending", storeId: "store_1", status: "pending" });
    seedRequest({ id: "req_sent", storeId: "store_1", status: "sent" });
    seedRequest({ id: "req_completed", storeId: "store_1", status: "completed" });
    // Different store — must never leak into store_1's counts.
    seedRequest({ id: "req_other_store", storeId: "store_2", status: "scheduled" });

    const stats = await reviewRequestService.getRequestStats("store_1");

    expect(stats).toEqual({
      totalCount: 4,
      sent: 2, // "sent" and "completed" both count as genuinely sent
      completed: 1,
      completionRate: 0.5,
      scheduled: 1,
      pending: 1,
    });
  });

  it("returns all zeros for a store with no requests yet, rather than throwing", async () => {
    const stats = await reviewRequestService.getRequestStats("store_1");

    expect(stats).toEqual({
      totalCount: 0,
      sent: 0,
      completed: 0,
      completionRate: 0,
      scheduled: 0,
      pending: 0,
    });
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

  it("resendRequest with sendNow bypasses delayDays and dispatches immediately", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", delayDays: 3, requestToken: "original-token" });

    const updated = await reviewRequestService.resendRequest("store_1", "req_1", { sendNow: true });

    // With the fake email provider (mocked above) resolving successfully, dispatchRequestEmail
    // lands on "sent" — proving sendNow bypassed the stored 3-day delay entirely rather than
    // just leaving it "scheduled" (what a plain resend of this same row would do).
    expect(updated.status).toBe("sent");
    expect(updated.delayDays).toBe(0);
  });

  it("resendRequest with sendNow still rejects an already-completed request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", status: "completed", delayDays: 3, requestToken: "original-token" });

    await expect(reviewRequestService.resendRequest("store_1", "req_1", { sendNow: true })).rejects.toThrow(
      "already completed",
    );
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

describe("status transition integrity", () => {
  it("cancelRequest is an idempotent no-op on an already-cancelled request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", status: "cancelled" });

    const result = await reviewRequestService.cancelRequest("store_1", "req_1");

    expect(result.status).toBe("cancelled");
  });

  it("cancelRequest rejects an already-completed request instead of silently overwriting it", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", status: "completed" });

    await expect(reviewRequestService.cancelRequest("store_1", "req_1")).rejects.toThrow(
      "already completed",
    );
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("completed");
  });

  it("resendRequest rejects an already-completed request (duplicate-review risk)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", status: "completed", requestToken: "original-token" });

    await expect(reviewRequestService.resendRequest("store_1", "req_1")).rejects.toThrow("already completed");
    expect(requests.find((r) => r.id === "req_1")?.requestToken).toBe("original-token");
  });

  it("resendRequest still allows reviving an already-cancelled request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", status: "cancelled", delayDays: 3, requestToken: "original-token" });

    const updated = await reviewRequestService.resendRequest("store_1", "req_1");

    expect(updated.status).toBe("scheduled");
    expect(updated.requestToken).not.toBe("original-token");
  });
});

describe("getExistingRequestContext — duplicate/already-reviewed detection", () => {
  it("flags a pending request for the same customer and product", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1", email: "jordan@example.com", status: "scheduled" });

    const context = await reviewRequestService.getExistingRequestContext("store_1", {
      email: "jordan@example.com",
      productId: "product_1",
    });

    expect(context).toEqual({ hasPendingRequest: true, hasSentRequest: false, hasExistingReview: false });
  });

  it("flags an already-sent (not yet completed) request separately from a pending one", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1", email: "jordan@example.com", status: "clicked" });

    const context = await reviewRequestService.getExistingRequestContext("store_1", {
      email: "jordan@example.com",
      productId: "product_1",
    });

    expect(context).toEqual({ hasPendingRequest: false, hasSentRequest: true, hasExistingReview: false });
  });

  it("flags an existing review for the same customer and product", async () => {
    reviews.push({
      storeId: "store_1",
      productId: "product_1",
      reviewerName: "Jordan",
      reviewerEmail: "jordan@example.com",
      deletedAt: null,
    });

    const context = await reviewRequestService.getExistingRequestContext("store_1", {
      email: "jordan@example.com",
      productId: "product_1",
    });

    expect(context).toEqual({ hasPendingRequest: false, hasSentRequest: false, hasExistingReview: true });
  });

  it("does not flag a completed or cancelled request as pending/sent — those are fine to re-request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1", email: "jordan@example.com", status: "completed" });
    seedRequest({ id: "req_2", storeId: "store_1", productId: "product_1", email: "morgan@example.com", status: "cancelled" });

    const context = await reviewRequestService.getExistingRequestContext("store_1", {
      email: "morgan@example.com",
      productId: "product_1",
    });

    expect(context).toEqual({ hasPendingRequest: false, hasSentRequest: false, hasExistingReview: false });
  });

  it("never sees another store's requests or reviews", async () => {
    seedRequest({ id: "req_1", storeId: "store_2", productId: "product_2", email: "jordan@example.com", status: "scheduled" });
    reviews.push({ storeId: "store_2", productId: "product_2", reviewerName: "Jordan", reviewerEmail: "jordan@example.com", deletedAt: null });

    const context = await reviewRequestService.getExistingRequestContext("store_1", {
      email: "jordan@example.com",
      productId: "product_2",
    });

    expect(context).toEqual({ hasPendingRequest: false, hasSentRequest: false, hasExistingReview: false });
  });
});

describe("webhook-driven status updates — forward-only and idempotent", () => {
  it("markRequestDelivered moves 'sent' -> 'delivered'", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "sent" });

    const changed = await reviewRequestService.markRequestDelivered("tok_1");

    expect(changed).toBe(true);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("delivered");
  });

  it("markRequestOpened never regresses a request that already moved past it (e.g. already clicked)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "clicked" });

    const changed = await reviewRequestService.markRequestOpened("tok_1");

    expect(changed).toBe(false);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("clicked");
  });

  it("markRequestDelivered is a no-op when the same event is delivered twice (idempotent)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "delivered" });

    const changed = await reviewRequestService.markRequestDelivered("tok_1");

    expect(changed).toBe(false);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("delivered");
  });

  it("delivery-tracking webhooks never touch a completed request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "completed" });

    expect(await reviewRequestService.markRequestDelivered("tok_1")).toBe(false);
    expect(await reviewRequestService.markRequestOpened("tok_1")).toBe(false);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("completed");
  });

  it("delivery-tracking webhooks never touch a cancelled request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "cancelled" });

    expect(await reviewRequestService.markRequestDelivered("tok_1")).toBe(false);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("cancelled");
  });

  it("markRequestDeliveryFailed moves 'sent' -> 'failed' (a genuine bounce)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "sent" });

    const changed = await reviewRequestService.markRequestDeliveryFailed("tok_1");

    expect(changed).toBe(true);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("failed");
  });

  it("markRequestDeliveryFailed ignores a stale bounce after the customer already clicked through", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "clicked" });

    const changed = await reviewRequestService.markRequestDeliveryFailed("tok_1");

    expect(changed).toBe(false);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("clicked");
  });

  it("markRequestDeliveryFailed ignores a bounce for an already-completed request", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: "tok_1", status: "completed" });

    const changed = await reviewRequestService.markRequestDeliveryFailed("tok_1");

    expect(changed).toBe(false);
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("completed");
  });

  it("gracefully handles an event for an unknown/deleted request token", async () => {
    expect(await reviewRequestService.markRequestDelivered("no-such-token")).toBe(false);
    expect(await reviewRequestService.markRequestOpened("no-such-token")).toBe(false);
    expect(await reviewRequestService.markRequestDeliveryFailed("no-such-token")).toBe(false);
  });
});

describe("dispatchReminderEmail", () => {
  it("sends reminder_1 and records it on reminder1SentAt only", async () => {
    const seeded = seedRequest({
      id: "req_1",
      storeId: "store_1",
      status: "sent",
      sentAt: new Date("2026-08-01"),
      reminder1SentAt: null,
      reminderFinalSentAt: null,
    });
    const request = await reviewRequestService.getRequest("req_1");

    await dispatchReminderEmail(request!, "reminder_1");

    const row = requests.find((r) => r.id === "req_1")!;
    expect(row.reminder1SentAt).not.toBeNull();
    expect(row.reminderFinalSentAt).toBeNull();
    // The original request's own lifecycle fields are never touched by a reminder send.
    expect(row.status).toBe("sent");
    expect(row.sentAt).toEqual(seeded.sentAt);
    expect(row.sendAttempts).toBe(0);
  });

  it("sends reminder_final and records it on reminderFinalSentAt only", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", status: "opened", sentAt: new Date("2026-08-01") });
    const request = await reviewRequestService.getRequest("req_1");

    await dispatchReminderEmail(request!, "reminder_final");

    const row = requests.find((r) => r.id === "req_1")!;
    expect(row.reminderFinalSentAt).not.toBeNull();
    expect(row.reminder1SentAt).toBeNull();
    expect(row.status).toBe("opened");
  });

  it("is a silent no-op when the request has no email on file", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", email: null, sentAt: new Date("2026-08-01") });
    const request = await reviewRequestService.getRequest("req_1");

    await dispatchReminderEmail(request!, "reminder_1");

    expect(requests.find((r) => r.id === "req_1")?.reminder1SentAt).toBeNull();
  });

  it("is a silent no-op when the request has no token (already consumed/cleared)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", requestToken: null, sentAt: new Date("2026-08-01") });
    const request = await reviewRequestService.getRequest("req_1");

    await dispatchReminderEmail(request!, "reminder_1");

    expect(requests.find((r) => r.id === "req_1")?.reminder1SentAt).toBeNull();
  });

  it("never sends and never sets reminder1SentAt for a suppressed recipient", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", email: "jordan@example.com", sentAt: new Date("2026-08-01") });
    suppressions.push({ storeId: "store_1", email: "jordan@example.com" });
    const request = await reviewRequestService.getRequest("req_1");

    await dispatchReminderEmail(request!, "reminder_1");

    expect(requests.find((r) => r.id === "req_1")?.reminder1SentAt).toBeNull();
  });

  it("suppression is store-scoped — a suppression on another store never blocks this one", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", email: "jordan@example.com", sentAt: new Date("2026-08-01") });
    suppressions.push({ storeId: "store_2", email: "jordan@example.com" });
    const request = await reviewRequestService.getRequest("req_1");

    await dispatchReminderEmail(request!, "reminder_1");

    expect(requests.find((r) => r.id === "req_1")?.reminder1SentAt).not.toBeNull();
  });
});

describe("dispatchRequestEmail — suppression", () => {
  it("never sends the Day-0 request email to a suppressed recipient — request lands unchanged, never 'failed'", async () => {
    const seeded = seedRequest({
      id: "req_1",
      storeId: "store_1",
      email: "jordan@example.com",
      status: "sending",
      sentAt: new Date("2026-08-01"),
    });
    suppressions.push({ storeId: "store_1", email: "jordan@example.com" });
    const request = await reviewRequestService.getRequest("req_1");

    const result = await dispatchRequestEmail(request!);

    // Returned unchanged — same convention as the existing missing-email/token guard — not
    // "failed" (which would imply a transient send error worth investigating/retrying).
    expect(result.status).toBe("sending");
    expect(requests.find((r) => r.id === "req_1")?.status).toBe(seeded.status);
    expect(requests.find((r) => r.id === "req_1")?.sendAttempts).toBe(0);
  });

  it("a non-suppressed recipient's Day-0 send is completely unaffected (regression check)", async () => {
    seedRequest({
      id: "req_1",
      storeId: "store_1",
      email: "jordan@example.com",
      status: "sending",
      sentAt: new Date("2026-08-01"),
    });
    const request = await reviewRequestService.getRequest("req_1");

    const result = await dispatchRequestEmail(request!);

    expect(result.status).toBe("sent");
    expect(requests.find((r) => r.id === "req_1")?.status).toBe("sent");
  });
});

describe("getExistingRequestContextBulk — Shopify Orders picker eligibility", () => {
  it("matches the single-pair getExistingRequestContext result for the same (email, productId)", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1", email: "jordan@example.com", status: "scheduled" });

    const bulk = await reviewRequestService.getExistingRequestContextBulk("store_1", [
      { email: "jordan@example.com", productId: "product_1" },
    ]);

    expect(bulk.get("jordan@example.com||product_1")).toEqual({
      hasPendingRequest: true,
      hasSentRequest: false,
      hasExistingReview: false,
    });
  });

  it("keeps every pair's result independent — no cross-contamination between rows in the same page", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1", email: "jordan@example.com", status: "scheduled" });
    reviews.push({ storeId: "store_1", productId: "product_1", reviewerName: "Morgan", reviewerEmail: "morgan@example.com", deletedAt: null });

    const bulk = await reviewRequestService.getExistingRequestContextBulk("store_1", [
      { email: "jordan@example.com", productId: "product_1" },
      { email: "morgan@example.com", productId: "product_1" },
      { email: "casey@example.com", productId: "product_1" },
    ]);

    expect(bulk.get("jordan@example.com||product_1")?.hasPendingRequest).toBe(true);
    expect(bulk.get("morgan@example.com||product_1")?.hasExistingReview).toBe(true);
    expect(bulk.get("casey@example.com||product_1")).toEqual({
      hasPendingRequest: false,
      hasSentRequest: false,
      hasExistingReview: false,
    });
  });

  it("never sees another store's requests or reviews", async () => {
    seedRequest({ id: "req_1", storeId: "store_2", productId: "product_2", email: "jordan@example.com", status: "scheduled" });

    const bulk = await reviewRequestService.getExistingRequestContextBulk("store_1", [
      { email: "jordan@example.com", productId: "product_2" },
    ]);

    expect(bulk.get("jordan@example.com||product_2")).toEqual({
      hasPendingRequest: false,
      hasSentRequest: false,
      hasExistingReview: false,
    });
  });

  it("returns an empty map for empty input without querying anything", async () => {
    const bulk = await reviewRequestService.getExistingRequestContextBulk("store_1", []);
    expect(bulk.size).toBe(0);
  });
});

// Direct unit coverage for the automatic webhook path's actual eligibility logic
// (webhooks.fulfillments.create.tsx calls this per fulfilled line item). Not previously
// covered directly — createManyFromOrders' own tests exercise it indirectly through the
// manual bulk-send flow, but the automatic order-trigger path deserves its own coverage
// since it's the exact function gated behind ORDER_AUTOMATION_ENABLED/Shopify's Protected
// Customer Data approval (see app/config/features.ts) — this suite is what proves the
// eligibility/duplicate-prevention logic is correct and ready for the moment that approval
// lands, independent of whether the webhook itself is currently reachable in production.
describe("createFromOrder — order-triggered eligibility (the automatic webhook's actual logic)", () => {
  const baseOrder = {
    storeId: "store_1",
    productId: "product_1",
    shopifyOrderId: "5001",
    shopifyLineItemId: "1",
    orderNumber: "#5001",
    email: "jordan@example.com",
    name: "Jordan Avery",
  };

  it("creates a real, order-tagged, scheduled request for an eligible order with a non-zero delay", async () => {
    const result = await reviewRequestService.createFromOrder({ ...baseOrder, delayDays: 7 });

    expect(result.request.status).toBe("scheduled");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      storeId: "store_1",
      productId: "product_1",
      shopifyOrderId: "5001",
      shopifyLineItemId: "1",
      source: "order",
      email: "jordan@example.com",
      status: "scheduled",
    });
  });

  it("dispatches immediately for an eligible order with delayDays: 0 — lands as sent, not left scheduled", async () => {
    const result = await reviewRequestService.createFromOrder({ ...baseOrder, delayDays: 0 });

    // Written as "sending" before dispatch, then dispatchRequestEmail (mocked provider,
    // resolves successfully) moves it to its real terminal state — "sent" — same as any other
    // immediate-send path in this file (see resendRequest's own sendNow test).
    expect(result.request.status).toBe("sent");
    expect(requests).toHaveLength(1);
    expect(requests[0].sentAt).not.toBeNull();
  });

  it("throws RequestNotEligibleError and creates nothing when the customer already reviewed this product", async () => {
    reviews.push({
      storeId: "store_1",
      productId: "product_1",
      reviewerName: "Jordan",
      reviewerEmail: "jordan@example.com",
      deletedAt: null,
    });

    await expect(reviewRequestService.createFromOrder({ ...baseOrder, delayDays: 7 })).rejects.toThrow(
      RequestNotEligibleError,
    );
    expect(requests).toHaveLength(0);
  });

  it("throws RequestNotEligibleError and creates nothing when a request for this customer/product is already pending", async () => {
    seedRequest({
      id: "req_existing",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      status: "scheduled",
    });

    await expect(
      reviewRequestService.createFromOrder({ ...baseOrder, shopifyOrderId: "9999", delayDays: 7 }),
    ).rejects.toThrow(RequestNotEligibleError);
    // Only the one pre-seeded request exists — the ineligible order created nothing.
    expect(requests).toHaveLength(1);
  });

  it("throws RequestNotEligibleError and creates nothing when a request for this customer/product was already sent", async () => {
    seedRequest({
      id: "req_sent",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      status: "sent",
    });

    await expect(
      reviewRequestService.createFromOrder({ ...baseOrder, shopifyOrderId: "9999", delayDays: 7 }),
    ).rejects.toThrow(RequestNotEligibleError);
    expect(requests).toHaveLength(1);
  });

  it("throws a real Prisma P2002 (not RequestNotEligibleError) when the (order, product) pair collides for a different customer — the webhook's at-least-once-delivery idempotency case", async () => {
    // Seeded directly (not via createFromOrder) under a *different* email than baseOrder's, so
    // getExistingRequestContext(email: jordan@..., productId: product_1) finds nothing and the
    // eligibility check passes cleanly — only then does the DB's real
    // @@unique([shopifyOrderId, productId]) constraint (which doesn't care about email at all)
    // fire, exactly as it would for Shopify redelivering the same fulfillment webhook.
    seedRequest({
      id: "req_other_customer",
      storeId: "store_1",
      productId: "product_1",
      email: "someone-else@example.com",
      shopifyOrderId: baseOrder.shopifyOrderId,
      shopifyLineItemId: baseOrder.shopifyLineItemId,
      source: "order",
      status: "scheduled",
    });

    await expect(reviewRequestService.createFromOrder({ ...baseOrder, delayDays: 7 })).rejects.toMatchObject({
      code: "P2002",
    });
    // No second row was created for the same (order, product) pair.
    expect(requests).toHaveLength(1);
  });

  it("never leaks into another store — an eligible order for store_2 is scoped correctly even when store_1 has a matching pending request", async () => {
    seedRequest({
      id: "req_store1",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      status: "scheduled",
    });

    const result = await reviewRequestService.createFromOrder({
      storeId: "store_2",
      productId: "product_2",
      shopifyOrderId: "5001",
      shopifyLineItemId: "1",
      orderNumber: "#5001",
      email: "jordan@example.com",
      name: "Jordan Avery",
      delayDays: 7,
    });

    expect(result.request.status).toBe("scheduled");
    expect(requests.filter((r) => r.storeId === "store_2")).toHaveLength(1);
  });

  it("treats a negative delayDays as 0 (immediate send) rather than a negative scheduled date", async () => {
    const result = await reviewRequestService.createFromOrder({ ...baseOrder, delayDays: -5 });

    expect(result.request.status).toBe("sent");
    expect(requests[0].delayDays).toBe(0);
  });
});

describe("createManyFromOrders — the Shopify Orders bulk send flow", () => {
  const baseSelection = {
    productId: "product_1",
    orderNumber: "#1001",
    email: "jordan@example.com",
    name: "Jordan Avery",
    delayDays: 7,
  };

  it("creates one real, order-tagged request per selection", async () => {
    const result = await reviewRequestService.createManyFromOrders("store_1", [
      { ...baseSelection, shopifyOrderId: "1001", shopifyLineItemId: "1" },
      { ...baseSelection, shopifyOrderId: "1002", shopifyLineItemId: "2", email: "morgan@example.com", name: "Morgan" },
    ]);

    expect(result).toEqual({ created: 2, skippedDuplicates: 0, failed: 0 });
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.source === "order" && r.storeId === "store_1")).toBe(true);
  });

  it("skips (not fails) a selection that collides with an existing (shopifyOrderId, productId) pair — the same idempotency the automatic webhook relies on", async () => {
    seedRequest({ id: "req_1", storeId: "store_1", productId: "product_1", shopifyOrderId: "1001", source: "order" });

    const result = await reviewRequestService.createManyFromOrders("store_1", [
      { ...baseSelection, shopifyOrderId: "1001", shopifyLineItemId: "1" },
    ]);

    expect(result).toEqual({ created: 0, skippedDuplicates: 1, failed: 0 });
    // No second row was created for the same (order, product) pair.
    expect(requests.filter((r) => r.shopifyOrderId === "1001" && r.productId === "product_1")).toHaveLength(1);
  });

  it("skips a selection whose customer already reviewed the product — even from a different order than any existing request row", async () => {
    reviews.push({ storeId: "store_1", productId: "product_1", reviewerName: "Jordan", reviewerEmail: "jordan@example.com", deletedAt: null });

    // Deliberately a different shopifyOrderId than any seeded request, so the DB's
    // (shopifyOrderId, productId) unique constraint alone could never catch this — only the
    // real eligibility check inside createFromOrder can.
    const result = await reviewRequestService.createManyFromOrders("store_1", [
      { ...baseSelection, shopifyOrderId: "9999", shopifyLineItemId: "1" },
    ]);

    expect(result).toEqual({ created: 0, skippedDuplicates: 1, failed: 0 });
    expect(requests).toHaveLength(0);
  });

  it("skips a selection whose customer already has a sent request for the same product, from a different order", async () => {
    seedRequest({
      id: "req_sent",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      shopifyOrderId: "1000",
      source: "order",
      status: "sent",
    });

    const result = await reviewRequestService.createManyFromOrders("store_1", [
      { ...baseSelection, shopifyOrderId: "9999", shopifyLineItemId: "1" },
    ]);

    expect(result).toEqual({ created: 0, skippedDuplicates: 1, failed: 0 });
    // Only the one pre-seeded request exists — nothing new was created.
    expect(requests).toHaveLength(1);
  });

  it("one genuinely unexpected failure (not a duplicate) never aborts the rest of the batch", async () => {
    const dbServer = await import("../db.server");
    vi.mocked(dbServer.default.reviewRequest.create).mockRejectedValueOnce(new Error("Connection reset"));

    const result = await reviewRequestService.createManyFromOrders("store_1", [
      { ...baseSelection, shopifyOrderId: "1001", shopifyLineItemId: "1" },
      { ...baseSelection, shopifyOrderId: "1002", shopifyLineItemId: "2" },
    ]);

    expect(result).toEqual({ created: 1, skippedDuplicates: 0, failed: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0].shopifyOrderId).toBe("1002");
  });
});

// Not called by any scheduler/cron today (see the function's own comment in
// review-request.server.ts for why: the retention window is a business decision, not an
// engineering one) — this is coverage for the mechanism itself, so it's correct and ready
// whenever that decision lands.
describe("purgeStaleContactInfo — retention purge (dormant, not scheduled)", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date("2026-09-05T00:00:00Z");

  it("redacts email/name on an old, terminal (completed) request", async () => {
    seedRequest({
      id: "req_old_completed",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      name: "Jordan Avery",
      status: "completed",
      updatedAt: new Date(now.getTime() - 400 * DAY_MS),
    });

    const result = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

    expect(result).toEqual({ redacted: 1 });
    expect(requests[0].email).toBeNull();
    expect(requests[0].name).toBe("Redacted (retention policy)");
  });

  it("never touches a request younger than the retention window", async () => {
    seedRequest({
      id: "req_recent_completed",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      status: "completed",
      updatedAt: new Date(now.getTime() - 10 * DAY_MS),
    });

    const result = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

    expect(result).toEqual({ redacted: 0 });
    expect(requests[0].email).toBe("jordan@example.com");
  });

  it.each(["sent", "delivered", "opened", "clicked", "scheduled", "pending"] as const)(
    "never touches an old but non-terminal request (status: %s) — it could still become a real review",
    async (status) => {
      seedRequest({
        id: "req_old_active",
        storeId: "store_1",
        productId: "product_1",
        email: "jordan@example.com",
        status,
        updatedAt: new Date(now.getTime() - 400 * DAY_MS),
      });

      const result = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

      expect(result).toEqual({ redacted: 0 });
      expect(requests[0].email).toBe("jordan@example.com");
    },
  );

  it("redacts an old, terminal request regardless of whether it's failed or cancelled, not just completed", async () => {
    seedRequest({
      id: "req_old_failed",
      storeId: "store_1",
      productId: "product_1",
      email: "a@example.com",
      status: "failed",
      updatedAt: new Date(now.getTime() - 400 * DAY_MS),
    });
    seedRequest({
      id: "req_old_cancelled",
      storeId: "store_1",
      productId: "product_1",
      email: "b@example.com",
      status: "cancelled",
      updatedAt: new Date(now.getTime() - 400 * DAY_MS),
    });

    const result = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

    expect(result).toEqual({ redacted: 2 });
  });

  it("never touches Review content — only ReviewRequest's own contact fields", async () => {
    reviews.push({
      storeId: "store_1",
      productId: "product_1",
      reviewerName: "Jordan Avery",
      reviewerEmail: "jordan@example.com",
      deletedAt: null,
    });
    seedRequest({
      id: "req_old_completed",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      status: "completed",
      updatedAt: new Date(now.getTime() - 400 * DAY_MS),
    });

    await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

    expect(reviews[0].reviewerEmail).toBe("jordan@example.com");
    expect(reviews[0].reviewerName).toBe("Jordan Avery");
  });

  it("is idempotent — running it twice never double-counts an already-redacted row", async () => {
    seedRequest({
      id: "req_old_completed",
      storeId: "store_1",
      productId: "product_1",
      email: "jordan@example.com",
      status: "completed",
      updatedAt: new Date(now.getTime() - 400 * DAY_MS),
    });

    const first = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });
    const second = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

    expect(first).toEqual({ redacted: 1 });
    expect(second).toEqual({ redacted: 0 });
  });

  it("respects the bound (limit) — never redacts more rows than requested in one call", async () => {
    for (let i = 0; i < 5; i += 1) {
      seedRequest({
        id: `req_old_${i}`,
        storeId: "store_1",
        productId: "product_1",
        email: `person${i}@example.com`,
        status: "completed",
        updatedAt: new Date(now.getTime() - 400 * DAY_MS),
      });
    }

    const result = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, limit: 2, now });

    expect(result).toEqual({ redacted: 2 });
    expect(requests.filter((r) => r.email === null)).toHaveLength(2);
  });

  it("never leaks into another store", async () => {
    seedRequest({
      id: "req_store2",
      storeId: "store_2",
      productId: "product_2",
      email: "other@example.com",
      status: "completed",
      updatedAt: new Date(now.getTime() - 400 * DAY_MS),
    });

    const result = await reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 365, now });

    expect(result).toEqual({ redacted: 0 });
    expect(requests[0].email).toBe("other@example.com");
  });

  it("rejects an invalid retentionDays instead of silently purging everything", async () => {
    await expect(reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: 0 })).rejects.toThrow();
    await expect(reviewRequestService.purgeStaleContactInfo("store_1", { retentionDays: -5 })).rejects.toThrow();
  });
});
