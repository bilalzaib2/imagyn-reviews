// Exercises analytics.server.ts's date-range filtering, groupBy/aggregate shapes, and Pro
// conversion/AI-digest logic against fake in-memory tables — no real database. See
// product.server.test.ts for the same mocking convention this file follows.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeReview {
  id: string;
  storeId: string;
  status: string;
  rating: number;
  createdAt: Date;
  deletedAt: Date | null;
}

interface FakeRequest {
  id: string;
  storeId: string;
  status: string;
  source: string;
  delayDays: number | null;
  createdAt: Date;
  sentAt: Date | null;
  reviewedAt: Date | null;
}

interface FakeAiSummary {
  productId: string;
  productName: string;
  storeId: string;
  summary: string;
  positives: string;
  negatives: string;
  recommendation: string;
  reviewCountUsed: number;
  generatedAt: Date;
}

let reviews: FakeReview[];
let requests: FakeRequest[];
let aiSummaries: FakeAiSummary[];

function matchesBaseWhere<T extends { storeId: string; createdAt: Date }>(
  row: T,
  where: { storeId: string; createdAt?: { gte: Date } },
): boolean {
  if (row.storeId !== where.storeId) return false;
  if (where.createdAt && row.createdAt < where.createdAt.gte) return false;
  return true;
}

vi.mock("../db.server", () => ({
  default: {
    review: {
      count: vi.fn(async (args: { where: { storeId: string; deletedAt: null; createdAt?: { gte: Date }; status?: string } }) => {
        return reviews.filter(
          (row) =>
            row.deletedAt === null &&
            matchesBaseWhere(row, args.where) &&
            (args.where.status === undefined || row.status === args.where.status),
        ).length;
      }),
      groupBy: vi.fn(
        async (args: {
          by: ["status"] | ["rating"];
          where: { storeId: string; deletedAt: null; createdAt?: { gte: Date }; status?: string };
        }) => {
          const filtered = reviews.filter(
            (row) =>
              row.deletedAt === null &&
              matchesBaseWhere(row, args.where) &&
              (args.where.status === undefined || row.status === args.where.status),
          );
          const key = args.by[0];
          const counts = new Map<string | number, number>();
          for (const row of filtered) {
            const value = row[key];
            counts.set(value, (counts.get(value) ?? 0) + 1);
          }
          return Array.from(counts.entries()).map(([value, count]) => ({
            [key]: value,
            _count: { [key]: count },
          }));
        },
      ),
      aggregate: vi.fn(
        async (args: { where: { storeId: string; deletedAt: null; createdAt?: { gte: Date }; status: string } }) => {
          const filtered = reviews.filter(
            (row) => row.deletedAt === null && matchesBaseWhere(row, args.where) && row.status === args.where.status,
          );
          if (filtered.length === 0) return { _avg: { rating: null } };
          const avg = filtered.reduce((sum, row) => sum + row.rating, 0) / filtered.length;
          return { _avg: { rating: avg } };
        },
      ),
      findMany: vi.fn(async (args: { where: { storeId: string; deletedAt: null; createdAt?: { gte: Date } } }) => {
        return reviews
          .filter((row) => row.deletedAt === null && matchesBaseWhere(row, args.where))
          .map((row) => ({ createdAt: row.createdAt }));
      }),
    },
    reviewRequest: {
      groupBy: vi.fn(async (args: { by: ["status"]; where: { storeId: string; createdAt?: { gte: Date } } }) => {
        const filtered = requests.filter((row) => matchesBaseWhere(row, args.where));
        const counts = new Map<string, number>();
        for (const row of filtered) {
          counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
        }
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } }));
      }),
      findMany: vi.fn(
        async (args: {
          where: { storeId: string; createdAt?: { gte: Date } };
          select?: Record<string, boolean>;
        }) => {
          const filtered = requests.filter((row) => matchesBaseWhere(row, args.where));
          if (args.select && Object.keys(args.select).length === 1 && args.select.createdAt) {
            return filtered.map((row) => ({ createdAt: row.createdAt }));
          }
          return filtered.map((row) => ({
            status: row.status,
            source: row.source,
            delayDays: row.delayDays,
            sentAt: row.sentAt,
            reviewedAt: row.reviewedAt,
          }));
        },
      ),
    },
    productAiSummary: {
      findMany: vi.fn(async (args: { where: { product: { storeId: string } }; take: number }) => {
        return aiSummaries
          .filter((row) => row.storeId === args.where.product.storeId)
          .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())
          .slice(0, args.take)
          .map((row) => ({
            summary: row.summary,
            positives: row.positives,
            negatives: row.negatives,
            recommendation: row.recommendation,
            reviewCountUsed: row.reviewCountUsed,
            generatedAt: row.generatedAt,
            product: { id: row.productId, name: row.productName },
          }));
      }),
    },
  },
}));

const {
  getReviewAnalytics,
  getRequestAnalytics,
  getConversionInsights,
  getAiInsightsDigest,
} = await import("./analytics.server");

const daysAgo = (n: number) => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date;
};

describe("getReviewAnalytics", () => {
  beforeEach(() => {
    reviews = [];
  });

  it("counts only reviews within the selected range, scoped to the store", async () => {
    reviews = [
      { id: "r1", storeId: "store_1", status: "APPROVED", rating: 5, createdAt: daysAgo(2), deletedAt: null },
      { id: "r2", storeId: "store_1", status: "APPROVED", rating: 4, createdAt: daysAgo(40), deletedAt: null },
      { id: "r3", storeId: "store_2", status: "APPROVED", rating: 5, createdAt: daysAgo(2), deletedAt: null },
    ];

    const result = await getReviewAnalytics("store_1", "30d");
    expect(result.totalReviews).toBe(1);
  });

  it("computes averageRating from APPROVED reviews only", async () => {
    reviews = [
      { id: "r1", storeId: "store_1", status: "APPROVED", rating: 5, createdAt: daysAgo(1), deletedAt: null },
      { id: "r2", storeId: "store_1", status: "APPROVED", rating: 3, createdAt: daysAgo(1), deletedAt: null },
      { id: "r3", storeId: "store_1", status: "PENDING", rating: 1, createdAt: daysAgo(1), deletedAt: null },
    ];

    const result = await getReviewAnalytics("store_1", "30d");
    expect(result.averageRating).toBe(4);
    expect(result.statusCounts).toEqual({ approved: 2, pending: 1, rejected: 0 });
  });

  it("excludes soft-deleted reviews", async () => {
    reviews = [{ id: "r1", storeId: "store_1", status: "APPROVED", rating: 5, createdAt: daysAgo(1), deletedAt: new Date() }];

    const result = await getReviewAnalytics("store_1", "30d");
    expect(result.totalReviews).toBe(0);
  });

  it("trend buckets by calendar day and includes zero-activity days", async () => {
    reviews = [
      { id: "r1", storeId: "store_1", status: "APPROVED", rating: 5, createdAt: daysAgo(0), deletedAt: null },
      { id: "r2", storeId: "store_1", status: "APPROVED", rating: 5, createdAt: daysAgo(0), deletedAt: null },
    ];

    const result = await getReviewAnalytics("store_1", "7d");
    expect(result.trend).toHaveLength(7);
    expect(result.trend[result.trend.length - 1].count).toBe(2);
    expect(result.trend[0].count).toBe(0);
  });

  it("'all' range has no lower bound and anchors the trend to the earliest review", async () => {
    reviews = [{ id: "r1", storeId: "store_1", status: "APPROVED", rating: 5, createdAt: daysAgo(200), deletedAt: null }];

    const result = await getReviewAnalytics("store_1", "all");
    expect(result.totalReviews).toBe(1);
    expect(result.trend.length).toBeGreaterThan(190);
  });
});

describe("getRequestAnalytics", () => {
  beforeEach(() => {
    requests = [];
  });

  it("computes sent/completed/completionRate correctly", async () => {
    requests = [
      { id: "req1", storeId: "store_1", status: "sent", source: "manual", delayDays: 3, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: null },
      { id: "req2", storeId: "store_1", status: "completed", source: "manual", delayDays: 3, createdAt: daysAgo(2), sentAt: daysAgo(2), reviewedAt: daysAgo(1) },
      { id: "req3", storeId: "store_1", status: "scheduled", source: "manual", delayDays: 3, createdAt: daysAgo(1), sentAt: null, reviewedAt: null },
    ];

    const result = await getRequestAnalytics("store_1", "30d");
    expect(result.totalRequests).toBe(3);
    expect(result.sent).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.completionRate).toBe(0.5);
  });

  it("completionRate is 0 (not NaN) when nothing has been sent yet", async () => {
    requests = [{ id: "req1", storeId: "store_1", status: "scheduled", source: "manual", delayDays: 3, createdAt: daysAgo(1), sentAt: null, reviewedAt: null }];

    const result = await getRequestAnalytics("store_1", "30d");
    expect(result.completionRate).toBe(0);
  });
});

describe("getConversionInsights (Pro)", () => {
  beforeEach(() => {
    requests = [];
  });

  it("computes averageTimeToConversionHours from real sentAt/reviewedAt only", async () => {
    const sentAt = new Date("2026-01-01T00:00:00Z");
    const reviewedAt = new Date("2026-01-02T12:00:00Z"); // 36 hours later

    requests = [
      { id: "req1", storeId: "store_1", status: "completed", source: "manual", delayDays: 3, createdAt: daysAgo(5), sentAt, reviewedAt },
    ];

    const result = await getConversionInsights("store_1", "30d");
    expect(result.averageTimeToConversionHours).toBe(36);
  });

  it("is null when nothing has completed with both timestamps", async () => {
    requests = [{ id: "req1", storeId: "store_1", status: "sent", source: "manual", delayDays: 3, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: null }];

    const result = await getConversionInsights("store_1", "30d");
    expect(result.averageTimeToConversionHours).toBeNull();
  });

  it("breaks conversion down by source, counting only sent-or-later requests", async () => {
    requests = [
      { id: "req1", storeId: "store_1", status: "completed", source: "manual", delayDays: 0, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: daysAgo(0) },
      { id: "req2", storeId: "store_1", status: "sent", source: "order", delayDays: 7, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: null },
      { id: "req3", storeId: "store_1", status: "scheduled", source: "order", delayDays: 7, createdAt: daysAgo(1), sentAt: null, reviewedAt: null },
    ];

    const result = await getConversionInsights("store_1", "30d");
    const manual = result.bySource.find((row) => row.source === "manual");
    const order = result.bySource.find((row) => row.source === "order");
    expect(manual).toEqual({ source: "manual", sent: 1, completed: 1, completionRate: 1 });
    expect(order).toEqual({ source: "order", sent: 1, completed: 0, completionRate: 0 });
  });

  it("buckets by delay correctly (0 / 1-3 / 4-7 / 8+)", async () => {
    requests = [
      { id: "req1", storeId: "store_1", status: "sent", source: "manual", delayDays: 0, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: null },
      { id: "req2", storeId: "store_1", status: "sent", source: "manual", delayDays: 2, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: null },
      { id: "req3", storeId: "store_1", status: "sent", source: "manual", delayDays: 10, createdAt: daysAgo(1), sentAt: daysAgo(1), reviewedAt: null },
    ];

    const result = await getConversionInsights("store_1", "30d");
    expect(result.byDelayBucket.find((b) => b.bucket === "Immediate (0 days)")?.sent).toBe(1);
    expect(result.byDelayBucket.find((b) => b.bucket === "1–3 days")?.sent).toBe(1);
    expect(result.byDelayBucket.find((b) => b.bucket === "8+ days")?.sent).toBe(1);
    expect(result.byDelayBucket.find((b) => b.bucket === "4–7 days")?.sent).toBe(0);
  });
});

describe("getAiInsightsDigest (Pro)", () => {
  beforeEach(() => {
    aiSummaries = [];
  });

  it("reuses already-generated ProductAiSummary rows, scoped to the store, most recent first", async () => {
    aiSummaries = [
      {
        productId: "p1",
        productName: "Older Product",
        storeId: "store_1",
        summary: "s",
        positives: "[]",
        negatives: "[]",
        recommendation: "Great fit for casual buyers.",
        reviewCountUsed: 12,
        generatedAt: daysAgo(10),
      },
      {
        productId: "p2",
        productName: "Newer Product",
        storeId: "store_1",
        summary: "s",
        positives: "[]",
        negatives: "[]",
        recommendation: "Popular for gifting.",
        reviewCountUsed: 8,
        generatedAt: daysAgo(1),
      },
      {
        productId: "p3",
        productName: "Other Store Product",
        storeId: "store_2",
        summary: "s",
        positives: "[]",
        negatives: "[]",
        recommendation: "Should never appear.",
        reviewCountUsed: 5,
        generatedAt: daysAgo(0),
      },
    ];

    const digest = await getAiInsightsDigest("store_1");
    expect(digest).toHaveLength(2);
    expect(digest[0].productName).toBe("Newer Product");
    expect(digest.some((entry) => entry.productName === "Other Store Product")).toBe(false);
  });
});
