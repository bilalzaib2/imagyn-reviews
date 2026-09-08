// Exercises draftReplyForReview's storeId ownership check and its plan gate against a fake
// in-memory Prisma client and a fake AI provider — no real database, no real network. Mirrors
// aiSummary.server.test.ts's cross-tenant coverage, since this function has the exact same
// shape of risk (a merchant guessing another store's reviewId).
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeReview {
  id: string;
  storeId: string;
  rating: number;
  title: string | null;
  content: string;
  deletedAt: Date | null;
  product: { name: string };
}

let reviews: FakeReview[];
let storePlan: string;

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUnique: vi.fn(async () => ({ plan: storePlan })),
    },
    review: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string; deletedAt: null } }) => {
        const review = reviews.find((r) => r.id === where.id && r.storeId === where.storeId && r.deletedAt === null);
        return review
          ? { rating: review.rating, title: review.title, content: review.content, product: review.product }
          : null;
      }),
    },
  },
}));

const generateReplyDraftMock = vi.fn(async () => ({
  draft: "Thanks so much for the kind words about the fit!",
  modelUsed: "fake-model",
}));

vi.mock("./ai/provider.server", () => ({
  getAiProvider: () => ({
    name: "fake-provider",
    generateReplyDraft: generateReplyDraftMock,
  }),
}));

const { draftReplyForReview } = await import("./aiReplyDraft.server");

beforeEach(() => {
  storePlan = "owner";
  generateReplyDraftMock.mockClear();
  reviews = [
    {
      id: "review_1",
      storeId: "store_1",
      rating: 5,
      title: "Great fit",
      content: "Fits perfectly and the fabric feels premium.",
      deletedAt: null,
      product: { name: "Grace Star Dress" },
    },
    {
      id: "review_2",
      storeId: "store_2",
      rating: 2,
      title: null,
      content: "Shipping took too long.",
      deletedAt: null,
      product: { name: "Other Store's Product" },
    },
  ];
});

describe("draftReplyForReview — cross-tenant isolation", () => {
  it("rejects a reviewId that belongs to a different store", async () => {
    await expect(draftReplyForReview("store_1", "review_2", null)).rejects.toThrow("Review not found.");
    expect(generateReplyDraftMock).not.toHaveBeenCalled();
  });

  it("never calls the AI provider with another store's review content", async () => {
    await expect(draftReplyForReview("store_1", "review_2", null)).rejects.toThrow();
    expect(generateReplyDraftMock).not.toHaveBeenCalled();
  });
});

describe("draftReplyForReview — plan gate", () => {
  it("rejects a Starter-plan store before ever calling the AI provider", async () => {
    storePlan = "starter";
    await expect(draftReplyForReview("store_1", "review_1", null)).rejects.toThrow("AI reply drafts require the Pro plan.");
    expect(generateReplyDraftMock).not.toHaveBeenCalled();
  });
});

describe("draftReplyForReview — success path", () => {
  it("returns the AI provider's draft for a review owned by the caller's store", async () => {
    const result = await draftReplyForReview("store_1", "review_1", null);

    expect(result).toEqual({
      draft: "Thanks so much for the kind words about the fit!",
      provider: "fake-provider",
      modelUsed: "fake-model",
    });
  });

  it("passes the review's real rating/title/content and product name to the AI provider", async () => {
    await draftReplyForReview("store_1", "review_1", null);

    expect(generateReplyDraftMock).toHaveBeenCalledWith({
      productName: "Grace Star Dress",
      review: { rating: 5, title: "Great fit", content: "Fits perfectly and the fabric feels premium." },
      existingDraft: null,
    });
  });

  it("forwards the merchant's own in-progress draft, trimmed, rather than discarding it", async () => {
    await draftReplyForReview("store_1", "review_1", "  thanks!  ");

    expect(generateReplyDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ existingDraft: "thanks!" }),
    );
  });

  it("treats a blank/whitespace-only existing draft the same as no draft at all", async () => {
    await draftReplyForReview("store_1", "review_1", "   ");

    expect(generateReplyDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ existingDraft: null }),
    );
  });
});
