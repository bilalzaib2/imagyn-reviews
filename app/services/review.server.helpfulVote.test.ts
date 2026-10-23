// Pins the tenant boundary on castHelpfulVote against a fake in-memory Prisma client.
//
// This exists because the function originally took only (reviewId, visitorId, vote) and
// validated nothing but "is this review APPROVED and not deleted". A valid App Proxy signature
// proves only that *some* shop with the app installed forwarded the request — it says nothing
// about which shop's reviews the body refers to. Combined with api.public.v1.reviews.tsx handing
// out review ids for the whole network unauthenticated, that let any installer move any store's
// helpfulCount, which rankByHelpfulness turns into the storefront's "Most helpful" ordering.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeReview {
  id: string;
  storeId: string;
  status: string;
  deletedAt: Date | null;
  helpfulCount: number;
  notHelpfulCount: number;
}

interface FakeVote {
  reviewId: string;
  visitorId: string;
  vote: string;
}

let reviews: FakeReview[];
let votes: FakeVote[];

interface ReviewWhere {
  id: string;
  storeId?: string;
  deletedAt: null;
  status: string;
}

const tx = {
  review: {
    findFirst: vi.fn(async ({ where }: { where: ReviewWhere }) => {
      const found = reviews.find(
        (r) =>
          r.id === where.id &&
          r.deletedAt === where.deletedAt &&
          r.status === where.status &&
          // The assertion under test: when storeId is part of the query it must actually filter.
          (where.storeId === undefined || r.storeId === where.storeId),
      );
      return found ? { id: found.id } : null;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { helpfulCount: number; notHelpfulCount: number };
      }) => {
        const row = reviews.find((r) => r.id === where.id)!;
        row.helpfulCount = data.helpfulCount;
        row.notHelpfulCount = data.notHelpfulCount;
        return row;
      },
    ),
  },
  reviewHelpfulVote: {
    upsert: vi.fn(
      async ({
        where,
        update,
        create,
      }: {
        where: { reviewId_visitorId: { reviewId: string; visitorId: string } };
        update: { vote: string };
        create: FakeVote;
      }) => {
        const { reviewId, visitorId } = where.reviewId_visitorId;
        const existing = votes.find((v) => v.reviewId === reviewId && v.visitorId === visitorId);
        if (existing) {
          existing.vote = update.vote;
          return existing;
        }
        votes.push({ ...create });
        return create;
      },
    ),
    count: vi.fn(async ({ where }: { where: { reviewId: string; vote: string } }) =>
      votes.filter((v) => v.reviewId === where.reviewId && v.vote === where.vote).length,
    ),
  },
};

vi.mock("../db.server", () => ({
  default: {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

const { castHelpfulVote, HelpfulVoteValue } = await import("./review.server");

beforeEach(() => {
  reviews = [
    { id: "rev_store1", storeId: "store_1", status: "APPROVED", deletedAt: null, helpfulCount: 0, notHelpfulCount: 0 },
    { id: "rev_store2", storeId: "store_2", status: "APPROVED", deletedAt: null, helpfulCount: 0, notHelpfulCount: 0 },
    { id: "rev_pending", storeId: "store_1", status: "PENDING", deletedAt: null, helpfulCount: 0, notHelpfulCount: 0 },
    {
      id: "rev_deleted",
      storeId: "store_1",
      status: "APPROVED",
      deletedAt: new Date("2026-01-01"),
      helpfulCount: 0,
      notHelpfulCount: 0,
    },
  ];
  votes = [];
  vi.clearAllMocks();
});

describe("castHelpfulVote — tenant isolation", () => {
  it("records a vote on a review belonging to the calling store", async () => {
    const result = await castHelpfulVote("store_1", "rev_store1", "visitor_a", HelpfulVoteValue.HELPFUL);
    expect(result).toEqual({ helpfulCount: 1, notHelpfulCount: 0, vote: HelpfulVoteValue.HELPFUL });
  });

  // The vulnerability, pinned.
  it("refuses to vote on another store's review", async () => {
    await expect(
      castHelpfulVote("store_1", "rev_store2", "visitor_a", HelpfulVoteValue.HELPFUL),
    ).rejects.toThrow("Review not found.");
  });

  it("writes nothing at all when the review belongs to another store", async () => {
    await expect(
      castHelpfulVote("store_1", "rev_store2", "visitor_a", HelpfulVoteValue.HELPFUL),
    ).rejects.toThrow();
    expect(votes).toHaveLength(0);
    expect(tx.reviewHelpfulVote.upsert).not.toHaveBeenCalled();
    expect(tx.review.update).not.toHaveBeenCalled();
  });

  it("cannot move another store's helpfulCount", async () => {
    const before = reviews.find((r) => r.id === "rev_store2")!.helpfulCount;
    for (let i = 0; i < 25; i++) {
      await expect(
        castHelpfulVote("store_1", "rev_store2", `visitor_${i}`, HelpfulVoteValue.HELPFUL),
      ).rejects.toThrow();
    }
    expect(reviews.find((r) => r.id === "rev_store2")!.helpfulCount).toBe(before);
  });

  it("passes storeId into the lookup query rather than filtering afterwards", async () => {
    await castHelpfulVote("store_1", "rev_store1", "visitor_a", HelpfulVoteValue.HELPFUL);
    expect(tx.review.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "rev_store1", storeId: "store_1" }),
      }),
    );
  });

  it("reports another store's review as not-found, never as forbidden", async () => {
    // Indistinguishable from a nonexistent id, so the endpoint can't be used to probe which
    // review ids exist on other stores.
    const crossStore = await castHelpfulVote("store_1", "rev_store2", "v", HelpfulVoteValue.HELPFUL).catch(
      (e: Error) => e.message,
    );
    const nonexistent = await castHelpfulVote("store_1", "rev_nope", "v", HelpfulVoteValue.HELPFUL).catch(
      (e: Error) => e.message,
    );
    expect(crossStore).toBe(nonexistent);
  });
});

describe("castHelpfulVote — existing guarantees still hold", () => {
  it("still rejects a non-APPROVED review", async () => {
    await expect(
      castHelpfulVote("store_1", "rev_pending", "visitor_a", HelpfulVoteValue.HELPFUL),
    ).rejects.toThrow("Review not found.");
  });

  it("still rejects a soft-deleted review", async () => {
    await expect(
      castHelpfulVote("store_1", "rev_deleted", "visitor_a", HelpfulVoteValue.HELPFUL),
    ).rejects.toThrow("Review not found.");
  });

  it("still requires a visitor identifier", async () => {
    await expect(castHelpfulVote("store_1", "rev_store1", "", HelpfulVoteValue.HELPFUL)).rejects.toThrow(
      "A visitor identifier is required.",
    );
  });

  it("one visitor changing their mind replaces their vote rather than adding one", async () => {
    await castHelpfulVote("store_1", "rev_store1", "visitor_a", HelpfulVoteValue.HELPFUL);
    const result = await castHelpfulVote("store_1", "rev_store1", "visitor_a", HelpfulVoteValue.NOT_HELPFUL);
    expect(result).toEqual({ helpfulCount: 0, notHelpfulCount: 1, vote: HelpfulVoteValue.NOT_HELPFUL });
    expect(votes).toHaveLength(1);
  });

  it("recomputes counts from the vote rows rather than incrementing", async () => {
    await castHelpfulVote("store_1", "rev_store1", "visitor_a", HelpfulVoteValue.HELPFUL);
    await castHelpfulVote("store_1", "rev_store1", "visitor_b", HelpfulVoteValue.HELPFUL);
    const result = await castHelpfulVote("store_1", "rev_store1", "visitor_c", HelpfulVoteValue.NOT_HELPFUL);
    expect(result).toEqual({ helpfulCount: 2, notHelpfulCount: 1, vote: HelpfulVoteValue.NOT_HELPFUL });
  });
});
