// The counts beside the Reviews screen's status tabs.
//
// These are easy to get subtly wrong in a way nobody notices: a count that silently applies a
// different filter set from the table it labels still renders a plausible number. So what is
// pinned here is the RELATIONSHIP between the two — the counts must share every filter with
// the list except the one the tabs themselves control.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

const groupBy = vi.fn();

vi.mock("../db.server", () => ({
  default: {
    review: {
      get groupBy() {
        return groupBy;
      },
    },
  },
}));

const { getStoreReviewStatusCounts } = await import("./review.server");

/** The `where` the service handed Prisma on the last call. */
const lastWhere = () => groupBy.mock.calls[0][0].where;

beforeEach(() => {
  groupBy.mockReset();
  groupBy.mockResolvedValue([]);
});

describe("the numbers", () => {
  it("totals each status and sums them into All", async () => {
    groupBy.mockResolvedValue([
      { status: ReviewStatus.PENDING, _count: { _all: 7 } },
      { status: ReviewStatus.APPROVED, _count: { _all: 12 } },
      { status: ReviewStatus.REJECTED, _count: { _all: 2 } },
    ]);

    const counts = await getStoreReviewStatusCounts("store_1");

    expect(counts[ReviewStatus.PENDING]).toBe(7);
    expect(counts[ReviewStatus.APPROVED]).toBe(12);
    expect(counts[ReviewStatus.REJECTED]).toBe(2);
    expect(counts.all).toBe(21);
  });

  it("reports zero for a status with no rows rather than leaving it undefined", async () => {
    // A missing key renders as an empty chip; 0 is the fact the query actually returned.
    groupBy.mockResolvedValue([{ status: ReviewStatus.APPROVED, _count: { _all: 3 } }]);

    const counts = await getStoreReviewStatusCounts("store_1");

    expect(counts[ReviewStatus.PENDING]).toBe(0);
    expect(counts[ReviewStatus.REJECTED]).toBe(0);
    expect(counts.all).toBe(3);
  });

  it("returns all zeros for a store with no reviews", async () => {
    const counts = await getStoreReviewStatusCounts("store_1");
    expect(counts).toEqual({ all: 0, [ReviewStatus.PENDING]: 0, [ReviewStatus.APPROVED]: 0, [ReviewStatus.REJECTED]: 0 });
  });

  it("asks the database once, not once per status", async () => {
    await getStoreReviewStatusCounts("store_1");
    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});

describe("which filters the counts obey", () => {
  it("scopes to the store and excludes deleted reviews", async () => {
    await getStoreReviewStatusCounts("store_1");
    expect(lastWhere()).toMatchObject({ storeId: "store_1", deletedAt: null });
  });

  it("ignores the selected status, so every tab keeps a real count", async () => {
    // Filtering by the active tab would make every other tab read zero — the one bug that
    // makes the whole feature worse than having no counts.
    await getStoreReviewStatusCounts("store_1", { status: ReviewStatus.PENDING });
    expect(lastWhere().status).toBeUndefined();
  });

  it("applies the search, so the counts narrow in step with the table", async () => {
    await getStoreReviewStatusCounts("store_1", { search: "broken" });
    expect(JSON.stringify(lastWhere())).toContain("broken");
  });

  it.each([
    ["rating", { rating: 5 }, (w: Record<string, unknown>) => expect(w.rating).toBe(5)],
    [
      "verified purchase",
      { verifiedPurchase: true },
      (w: Record<string, unknown>) => expect(w.verifiedPurchase).toBe(true),
    ],
  ])("applies the %s filter", async (_label, options, assertion) => {
    await getStoreReviewStatusCounts("store_1", options);
    assertion(lastWhere());
  });

  it("applies a date range", async () => {
    await getStoreReviewStatusCounts("store_1", { dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    const createdAt = lastWhere().createdAt as { gte?: Date; lte?: Date };
    expect(createdAt.gte).toEqual(new Date("2026-01-01"));
    expect(createdAt.lte).toEqual(new Date("2026-01-31T23:59:59.999Z"));
  });

  it("never counts another store's reviews", async () => {
    await getStoreReviewStatusCounts("store_2", { search: "anything" });
    expect(lastWhere().storeId).toBe("store_2");
  });
});
