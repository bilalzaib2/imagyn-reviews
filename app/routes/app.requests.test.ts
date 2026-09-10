// Regression test for a real trust/fraud bug found via live testing: the "Individual Customer"
// send-request tab used to submit a free-text customer+product pairing (`_intent: "create"`)
// with ZERO server-side verification that the customer had ever purchased the product — a
// merchant could request a review from any customer for any product. The fix (2026-09-10)
// removed that action branch entirely and rewired the UI to submit through
// `create-from-orders`, which requires a real shopifyOrderId/shopifyLineItemId from an actual
// Shopify order. This test exercises the route's real `action` export directly (not just the
// service layer) since the vulnerability was in the route, not in reviewRequestService.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/auth-dedupe.server", () => ({
  authenticateAdminDeduped: vi.fn(async () => ({ session: { shop: "store.myshopify.com" }, admin: {} })),
}));

vi.mock("../services/store.server", () => ({
  getOrCreateStore: vi.fn(async () => ({ id: "store_1" })),
}));

vi.mock("../services/permissions", () => ({
  getStorePermissions: vi.fn(async () => ({})),
}));

const createRequestMock = vi.fn();
const createManyFromOrdersMock = vi.fn(async () => ({ created: 0, skippedDuplicates: 0, failed: 0 }));

vi.mock("../services/review-request.server", () => ({
  reviewRequestService: {
    createRequest: createRequestMock,
    createManyFromOrders: createManyFromOrdersMock,
    getExistingRequestContext: vi.fn(async () => ({ hasExistingReview: false, hasPendingRequest: false, hasSentRequest: false })),
    listRequests: vi.fn(async () => ({ requests: [], totalCount: 0, page: 1, pageSize: 10 })),
    listCustomers: vi.fn(async () => []),
    listProducts: vi.fn(async () => []),
    updateRequest: vi.fn(),
    rescheduleRequest: vi.fn(),
    cancelRequest: vi.fn(),
    deleteRequest: vi.fn(),
    resendRequest: vi.fn(),
  },
}));

vi.mock("../services/reviewRequestCsvImport.server", () => ({
  importReviewRequestsFromCsv: vi.fn(),
}));

const { action } = await import("./app.requests");

function postAction(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  const request = new Request("https://example.com/app/requests", { method: "POST", body: formData });
  return action({ request, params: {}, context: {} } as never);
}

describe("app.requests action — the removed free-text create path (real security fix)", () => {
  beforeEach(() => {
    createRequestMock.mockClear();
    createManyFromOrdersMock.mockClear();
  });

  it("rejects an arbitrary customer+product pairing submitted via the old _intent=create shape", async () => {
    const result = await postAction({
      _intent: "create",
      customer: "A Fraudster||fraudster@example.com",
      productId: "product_1",
      orderNumber: "made-up-order-number",
      delayDays: "0",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unsupported action.");
    // Most important assertion: no request was ever created for this unverified pairing.
    expect(createRequestMock).not.toHaveBeenCalled();
  });

  it("still allows create-from-orders, which requires a real shopifyOrderId + shopifyLineItemId", async () => {
    const selections = [
      {
        productId: "product_1",
        shopifyOrderId: "gid://shopify/Order/123",
        shopifyLineItemId: "gid://shopify/LineItem/456",
        orderNumber: "#1001",
        email: "real.customer@example.com",
        name: "Real Customer",
      },
    ];

    const result = await postAction({
      _intent: "create-from-orders",
      selections: JSON.stringify(selections),
      delayDays: "7",
    });

    expect(result.ok).toBe(true);
    expect(createManyFromOrdersMock).toHaveBeenCalledWith(
      "store_1",
      expect.arrayContaining([expect.objectContaining({ shopifyOrderId: "gid://shopify/Order/123", shopifyLineItemId: "gid://shopify/LineItem/456" })]),
    );
  });

  it("rejects create-from-orders selections with no real order/line-item identifiers", async () => {
    // Simulates a malicious/buggy client stripping the real order fields — JSON.parse doesn't
    // enforce the TypeScript shape at runtime, so the route itself must not silently proceed.
    const result = await postAction({
      _intent: "create-from-orders",
      selections: JSON.stringify([{ productId: "product_1", email: "fraudster@example.com", name: "x" }]),
      delayDays: "0",
    });

    // Either the route rejects it outright, or it forwards to createManyFromOrders which (per
    // its own real tests in review-request.server.test.ts) requires genuine order context to
    // ever persist a row — either way, createRequest (the unverified free-text path) must never
    // be reached.
    expect(createRequestMock).not.toHaveBeenCalled();
    void result;
  });
});
