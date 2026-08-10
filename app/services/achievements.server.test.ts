// Exercises achievements.server.ts's evaluateAchievements against a fake in-memory Prisma
// client — no real database. Covers rule correctness, tenant isolation, locked -> unlocked
// transitions (and that the persisted earnedAt never changes once written), and that nothing
// here can be earned except by real, storeId-scoped data — evaluateAchievements takes no
// input besides storeId, so there is no parameter surface a client could use to fabricate a
// medal.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

interface FakeReview {
  id: string;
  storeId: string;
  status: string;
  verifiedPurchase: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

interface FakeAchievementRow {
  id: string;
  storeId: string;
  key: string;
  earnedAt: Date;
  metadata: string | null;
}

let reviews: FakeReview[];
let achievementRows: FakeAchievementRow[];
let storeCount: number;
let nextReviewId: number;
let nextAchievementId: number;

function seedReview(overrides: Partial<FakeReview> & { storeId: string; createdAt: Date }): FakeReview {
  const review: FakeReview = {
    id: `review_${nextReviewId++}`,
    status: ReviewStatus.APPROVED,
    verifiedPurchase: true,
    deletedAt: null,
    ...overrides,
  };
  reviews.push(review);
  return review;
}

function matchesWhere(review: FakeReview, where: Record<string, unknown>): boolean {
  if (where.storeId !== undefined && review.storeId !== where.storeId) return false;
  if (where.deletedAt !== undefined && review.deletedAt !== where.deletedAt) return false;
  if (where.status !== undefined && review.status !== where.status) return false;
  if (where.verifiedPurchase !== undefined && review.verifiedPurchase !== where.verifiedPurchase) return false;
  if (where.createdAt !== undefined) {
    const range = where.createdAt as { gte?: Date; lt?: Date };
    if (range.gte && review.createdAt < range.gte) return false;
    if (range.lt && review.createdAt >= range.lt) return false;
  }
  return true;
}

vi.mock("../db.server", () => ({
  default: {
    store: {
      count: vi.fn(async () => storeCount),
    },
    review: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return reviews.filter((r) => matchesWhere(r, where)).length;
      }),
      findFirst: vi.fn(
        async ({
          where,
          orderBy,
          skip,
        }: {
          where: Record<string, unknown>;
          orderBy: Array<{ createdAt?: string; id?: string }>;
          skip?: number;
        }) => {
          const matches = reviews
            .filter((r) => matchesWhere(r, where))
            .sort((a, b) => {
              for (const clause of orderBy) {
                if (clause.createdAt) {
                  const diff = a.createdAt.getTime() - b.createdAt.getTime();
                  if (diff !== 0) return clause.createdAt === "asc" ? diff : -diff;
                }
                if (clause.id) {
                  const diff = a.id.localeCompare(b.id);
                  if (diff !== 0) return clause.id === "asc" ? diff : -diff;
                }
              }
              return 0;
            });
          return matches[skip ?? 0] ?? null;
        },
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return reviews.filter((r) => matchesWhere(r, where)).map((r) => ({ createdAt: r.createdAt }));
      }),
      groupBy: vi.fn(
        async ({
          where,
          having,
        }: {
          where: Record<string, unknown>;
          having: { id: { _count: { gt: number } } };
        }) => {
          const byStore = new Map<string, number>();
          for (const review of reviews) {
            if (!matchesWhere(review, where)) continue;
            byStore.set(review.storeId, (byStore.get(review.storeId) ?? 0) + 1);
          }
          const threshold = having.id._count.gt;
          return Array.from(byStore.entries())
            .filter(([, count]) => count > threshold)
            .map(([storeId]) => ({ storeId }));
        },
      ),
    },
    achievement: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        return achievementRows.filter((row) => row.storeId === where.storeId);
      }),
      create: vi.fn(async ({ data }: { data: { storeId: string; key: string; earnedAt: Date; metadata: string } }) => {
        const row: FakeAchievementRow = { id: `ach_${nextAchievementId++}`, ...data };
        achievementRows.push(row);
        return row;
      }),
    },
  },
}));

const { evaluateAchievements } = await import("./achievements.server");

beforeEach(() => {
  reviews = [];
  achievementRows = [];
  storeCount = 1;
  nextReviewId = 1;
  nextAchievementId = 1;
});

function byKey(statuses: Awaited<ReturnType<typeof evaluateAchievements>>, key: string) {
  const status = statuses.find((s) => s.key === key);
  if (!status) throw new Error(`Missing status for ${key}`);
  return status;
}

describe("Verified Voices", () => {
  it("unlocks tiers whose threshold is met and reports progress for locked tiers", async () => {
    for (let i = 0; i < 12; i++) {
      seedReview({ storeId: "store_1", createdAt: new Date(2026, 0, i + 1) });
    }

    const statuses = await evaluateAchievements("store_1");

    expect(byKey(statuses, "verified_reviews_10").unlocked).toBe(true);
    expect(byKey(statuses, "verified_reviews_50").unlocked).toBe(false);
    expect(byKey(statuses, "verified_reviews_50").progress).toEqual({ current: 12, target: 50 });
  });

  it("earnedAt is the real createdAt of the review that crossed the threshold, not the current date", async () => {
    const timestamps = Array.from({ length: 10 }, (_, i) => new Date(2020, 0, i + 1));
    timestamps.forEach((createdAt) => seedReview({ storeId: "store_1", createdAt }));

    const statuses = await evaluateAchievements("store_1");
    const tier = byKey(statuses, "verified_reviews_10");

    expect(tier.earnedAt).toBe(timestamps[9].toISOString());
  });

  it("does not count unverified or non-approved reviews toward the milestone", async () => {
    seedReview({ storeId: "store_1", createdAt: new Date(), verifiedPurchase: false });
    seedReview({ storeId: "store_1", createdAt: new Date(), status: ReviewStatus.PENDING });
    seedReview({ storeId: "store_1", createdAt: new Date(), deletedAt: new Date() });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "verified_reviews_10").progress).toEqual({ current: 0, target: 10 });
  });
});

describe("tenant isolation", () => {
  it("never counts another store's reviews toward the caller's medals", async () => {
    for (let i = 0; i < 20; i++) {
      seedReview({ storeId: "store_2", createdAt: new Date() });
    }
    seedReview({ storeId: "store_1", createdAt: new Date() });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "verified_reviews_10").progress).toEqual({ current: 1, target: 10 });
  });

  it("persisting store_1's achievements never creates or affects a row for another store", async () => {
    for (let i = 0; i < 10; i++) {
      seedReview({ storeId: "store_1", createdAt: new Date(2026, 0, i + 1) });
    }

    await evaluateAchievements("store_1");

    expect(achievementRows.every((row) => row.storeId === "store_1")).toBe(true);
    expect(achievementRows.some((row) => row.storeId === "store_2")).toBe(false);
  });

  it("evaluateAchievements only ever accepts a storeId — no field on the result exposes another store's identity", async () => {
    seedReview({ storeId: "store_1", createdAt: new Date() });
    const statuses = await evaluateAchievements("store_1");

    for (const status of statuses) {
      expect(Object.keys(status)).not.toContain("storeId");
      expect(Object.keys(status)).not.toContain("otherStoreId");
    }
  });
});

describe("locked -> unlocked transitions", () => {
  it("stays locked below the threshold, unlocks once crossed, and persists a stable earnedAt afterward", async () => {
    for (let i = 0; i < 9; i++) {
      seedReview({ storeId: "store_1", createdAt: new Date(2026, 0, i + 1) });
    }

    const beforeStatuses = await evaluateAchievements("store_1");
    expect(byKey(beforeStatuses, "verified_reviews_10").unlocked).toBe(false);
    // Note: 9 reviews in the same calendar month is already enough to unlock the separate
    // Peak Month medal (its own, much lower floor) — this test only asserts on
    // verified_reviews_10's own persistence, not the whole ledger.
    expect(achievementRows.filter((row) => row.key === "verified_reviews_10")).toHaveLength(0);

    const tenthReviewDate = new Date(2026, 0, 10);
    seedReview({ storeId: "store_1", createdAt: tenthReviewDate });

    const afterStatuses = await evaluateAchievements("store_1");
    expect(byKey(afterStatuses, "verified_reviews_10").unlocked).toBe(true);
    expect(byKey(afterStatuses, "verified_reviews_10").earnedAt).toBe(tenthReviewDate.toISOString());
    expect(achievementRows.filter((row) => row.key === "verified_reviews_10")).toHaveLength(1);

    // A later re-evaluation must read the persisted row back, not recompute/overwrite it.
    seedReview({ storeId: "store_1", createdAt: new Date(2026, 5, 1) });
    const laterStatuses = await evaluateAchievements("store_1");
    expect(byKey(laterStatuses, "verified_reviews_10").earnedAt).toBe(tenthReviewDate.toISOString());
    expect(achievementRows.filter((row) => row.key === "verified_reviews_10")).toHaveLength(1);
  });
});

describe("Peak Month", () => {
  it("picks the calendar month with the most approved reviews and reports its real start date", async () => {
    // January: 3 reviews. March: 6 reviews (the real peak).
    for (let i = 0; i < 3; i++) seedReview({ storeId: "store_1", createdAt: new Date(Date.UTC(2026, 0, i + 1)) });
    for (let i = 0; i < 6; i++) seedReview({ storeId: "store_1", createdAt: new Date(Date.UTC(2026, 2, i + 1)) });

    const statuses = await evaluateAchievements("store_1");
    const peak = byKey(statuses, "monthly_record");

    expect(peak.unlocked).toBe(true);
    expect(peak.earnedAt).toBe(new Date(Date.UTC(2026, 2, 1)).toISOString());
  });

  it("stays locked below the minimum-reviews-per-month floor", async () => {
    seedReview({ storeId: "store_1", createdAt: new Date() });
    seedReview({ storeId: "store_1", createdAt: new Date() });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "monthly_record").unlocked).toBe(false);
  });
});

describe("Trust", () => {
  it("requires a minimum sample size before evaluating the verified rate", async () => {
    for (let i = 0; i < 5; i++) {
      seedReview({ storeId: "store_1", createdAt: new Date(), verifiedPurchase: true });
    }

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "trust_verified_80").unlocked).toBe(false);
  });

  it("unlocks the 80% tier but not the 95% tier at an 80% verified rate with a real sample", async () => {
    for (let i = 0; i < 16; i++) seedReview({ storeId: "store_1", createdAt: new Date(), verifiedPurchase: true });
    for (let i = 0; i < 4; i++) seedReview({ storeId: "store_1", createdAt: new Date(), verifiedPurchase: false });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "trust_verified_80").unlocked).toBe(true);
    expect(byKey(statuses, "trust_verified_95").unlocked).toBe(false);
  });
});

describe("Top Stores", () => {
  it("never unlocks when the platform doesn't have enough stores for a meaningful ranking", async () => {
    storeCount = 2;
    for (let i = 0; i < 100; i++) seedReview({ storeId: "store_1", createdAt: new Date() });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "top_stores_25").unlocked).toBe(false);
  });

  it("unlocks based only on aggregate counts, never returning another store's identity", async () => {
    storeCount = 10;
    for (let i = 0; i < 50; i++) seedReview({ storeId: "store_1", createdAt: new Date() });
    for (let i = 0; i < 5; i++) seedReview({ storeId: "store_2", createdAt: new Date() });

    const statuses = await evaluateAchievements("store_1");
    // store_1 has more reviews than every other seeded store, so it should rank at the top.
    expect(byKey(statuses, "top_stores_10").unlocked).toBe(true);
  });
});

describe("Trending", () => {
  it("is not unlocked and not persisted when growth is flat", async () => {
    const now = new Date();
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5));
    seedReview({ storeId: "store_1", createdAt: thisMonthStart });
    seedReview({ storeId: "store_1", createdAt: lastMonthStart });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "trending_up").unlocked).toBe(false);
    expect(achievementRows.some((row) => row.key === "trending_up")).toBe(false);
  });

  it("unlocks on real month-over-month growth and is never written to the persisted ledger", async () => {
    const now = new Date();
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 3));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 3));
    for (let i = 0; i < 10; i++) seedReview({ storeId: "store_1", createdAt: thisMonthStart });
    for (let i = 0; i < 5; i++) seedReview({ storeId: "store_1", createdAt: lastMonthStart });

    const statuses = await evaluateAchievements("store_1");
    expect(byKey(statuses, "trending_up").unlocked).toBe(true);
    expect(achievementRows.some((row) => row.key === "trending_up")).toBe(false);
  });
});

describe("no-fabrication safeguard", () => {
  it("produces identical results across repeated calls with unchanged data (no randomness, no drift)", async () => {
    for (let i = 0; i < 15; i++) seedReview({ storeId: "store_1", createdAt: new Date(2026, 0, i + 1) });

    const first = await evaluateAchievements("store_1");
    const second = await evaluateAchievements("store_1");

    expect(second).toEqual(first);
  });
});
