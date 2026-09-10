// Exercises notifyReviewCreatedFlowTrigger's real guard/payload logic against a mocked
// unauthenticated.admin client — no real network. Never throws regardless of outcome, since
// review creation must never be blocked by a Flow API failure (or by Flow just not being
// configured, the common case).
import { beforeEach, describe, expect, it, vi } from "vitest";

const graphqlMock = vi.fn(async () => ({
  json: async () => ({ data: { flowTriggerReceive: { userErrors: [] as Array<{ field: string[] | null; message: string }> } } }),
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: vi.fn(async () => ({ admin: { graphql: graphqlMock } })),
  },
}));

const { notifyReviewCreatedFlowTrigger } = await import("./shopifyFlowTrigger.server");

beforeEach(() => {
  graphqlMock.mockClear();
});

describe("notifyReviewCreatedFlowTrigger", () => {
  it("does nothing when the product has no real Shopify id — never fires with a fabricated reference", async () => {
    await notifyReviewCreatedFlowTrigger({
      storeDomain: "shop.myshopify.com",
      shopifyProductId: null,
      rating: 5,
      title: "Great",
      content: "Loved it",
      reviewerName: "Jordan",
      verifiedPurchase: true,
    });

    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it("fires the real-review-created trigger with the extracted legacyResourceId and real field values", async () => {
    await notifyReviewCreatedFlowTrigger({
      storeDomain: "shop.myshopify.com",
      shopifyProductId: "gid://shopify/Product/8031152537913",
      rating: 5,
      title: "Great fit",
      content: "Loved it",
      reviewerName: "Jordan",
      verifiedPurchase: true,
    });

    expect(graphqlMock).toHaveBeenCalledTimes(1);
    const [query, options] = graphqlMock.mock.calls[0] as unknown as [
      string,
      { variables: { handle: string; payload: Record<string, unknown> } },
    ];
    expect(query).toContain("FlowTriggerReceive");
    expect(options.variables.handle).toBe("review-created");
    expect(options.variables.payload).toEqual({
      product_id: 8031152537913,
      Rating: 5,
      "Review Title": "Great fit",
      "Review Content": "Loved it",
      "Reviewer Name": "Jordan",
      "Verified Purchase": true,
    });
  });

  it("never throws when Shopify returns a userError — a Flow failure must never break review creation", async () => {
    graphqlMock.mockResolvedValueOnce({
      json: async () => ({ data: { flowTriggerReceive: { userErrors: [{ field: null, message: "No workflow configured" }] } } }),
    });

    await expect(
      notifyReviewCreatedFlowTrigger({
        storeDomain: "shop.myshopify.com",
        shopifyProductId: "gid://shopify/Product/1",
        rating: 4,
        title: null,
        content: "Fine",
        reviewerName: "Alex",
        verifiedPurchase: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws when the Shopify API call itself rejects", async () => {
    graphqlMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      notifyReviewCreatedFlowTrigger({
        storeDomain: "shop.myshopify.com",
        shopifyProductId: "gid://shopify/Product/1",
        rating: 3,
        title: null,
        content: "Ok",
        reviewerName: "Sam",
        verifiedPurchase: false,
      }),
    ).resolves.toBeUndefined();
  });
});
