// Imagyn Reviews — Analytics service layer.
//
// Every metric here is computed directly from real, already-stored rows (Review,
// ReviewRequest, ProductAiSummary) — no estimates, no fabricated figures, nothing invented
// for display purposes. Free-tier functions (getReviewAnalytics/getRequestAnalytics)
// generalize the exact same groupBy/aggregate patterns review.server.ts's
// getStoreReviewStats and review-request.server.ts's getRequestStats already use in
// production, just scoped to a date range instead of all-time. Pro-tier functions
// (getConversionInsights/getAiInsightsDigest) surface data that was already being stored
// (ReviewRequest.sentAt/reviewedAt/source/delayDays, ProductAiSummary) but never
// aggregated into a metric anywhere until now.
import prisma from "../db.server";
import { ReviewStatus } from "./review.shared";
import type { AnalyticsDateRange } from "./analytics.shared";

// null = no lower bound (all-time). UTC-anchored (not local-time setHours) so this stays
// consistent with bucketByDay's UTC day-keying (toISOString().slice(0,10)) regardless of the
// server process's local timezone — mixing the two caused an off-by-one-day bucketing bug
// outside UTC, caught by this file's own test suite.
function rangeStart(range: AnalyticsDateRange): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
}

// One bucket per calendar day (UTC) from `start` (or the earliest row, for "all time")
// through today, so a day with zero activity still renders as a real zero bar instead of a
// gap — matches how a merchant actually reads a trend chart.
function bucketByDay(dates: Date[], start: Date): Array<{ date: string; count: number }> {
  const counts = new Map<string, number>();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);

  for (const date of dates) {
    const key = dayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const buckets: Array<{ date: string; count: number }> = [];
  for (const cursor = new Date(start); cursor <= today; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = dayKey(cursor);
    buckets.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return buckets;
}

export interface ReviewAnalytics {
  range: AnalyticsDateRange;
  totalReviews: number;
  averageRating: number;
  ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
  statusCounts: { approved: number; pending: number; rejected: number };
  // Empty when range is "all" and there are no reviews yet (nothing to bucket from) —
  // the UI shows an empty state rather than an arbitrary-length zero chart.
  trend: Array<{ date: string; count: number }>;
}

// FREE. Mirrors getStoreReviewStats's exact groupBy/aggregate shape, scoped to a date range
// instead of all-time, plus a day-bucketed trend (fetches just `createdAt` for rows in
// range and buckets in JS — cheap even at real production volume for a bounded 7/30/90-day
// window; no raw SQL, consistent with every other query in this codebase).
export async function getReviewAnalytics(storeId: string, range: AnalyticsDateRange): Promise<ReviewAnalytics> {
  const start = rangeStart(range);
  const createdAtFilter = start ? { gte: start } : undefined;
  const baseWhere = { storeId, deletedAt: null, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) };

  const [totalReviews, statusGroups, approvedAggregate, ratingGroups, createdDates] = await Promise.all([
    prisma.review.count({ where: baseWhere }),
    prisma.review.groupBy({ by: ["status"], where: baseWhere, _count: { status: true } }),
    prisma.review.aggregate({ where: { ...baseWhere, status: ReviewStatus.APPROVED }, _avg: { rating: true } }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { ...baseWhere, status: ReviewStatus.APPROVED },
      _count: { rating: true },
    }),
    prisma.review.findMany({ where: baseWhere, select: { createdAt: true } }),
  ]);

  const countByStatus = new Map(statusGroups.map((group) => [group.status, group._count.status]));
  const countByRating = new Map(ratingGroups.map((group) => [group.rating, group._count.rating]));

  // "all time" has no fixed start — anchor the trend to the earliest review actually in the
  // data instead of an arbitrary distant date, so the chart isn't mostly empty space.
  const earliestCreatedAt = createdDates.reduce<Date | null>(
    (earliest, row) => (!earliest || row.createdAt < earliest ? row.createdAt : earliest),
    null,
  );
  const trendStart = start ?? earliestCreatedAt;

  return {
    range,
    totalReviews,
    averageRating: Number((approvedAggregate._avg.rating ?? 0).toFixed(1)),
    ratingCounts: {
      5: countByRating.get(5) ?? 0,
      4: countByRating.get(4) ?? 0,
      3: countByRating.get(3) ?? 0,
      2: countByRating.get(2) ?? 0,
      1: countByRating.get(1) ?? 0,
    },
    statusCounts: {
      approved: countByStatus.get(ReviewStatus.APPROVED) ?? 0,
      pending: countByStatus.get(ReviewStatus.PENDING) ?? 0,
      rejected: countByStatus.get(ReviewStatus.REJECTED) ?? 0,
    },
    trend: trendStart ? bucketByDay(createdDates.map((row) => row.createdAt), trendStart) : [],
  };
}

export interface RequestAnalytics {
  range: AnalyticsDateRange;
  totalRequests: number;
  sent: number;
  completed: number;
  completionRate: number;
  trend: Array<{ date: string; count: number }>;
}

// FREE. Same shape as review-request.server.ts's getRequestStats, scoped to a date range.
const SENT_STATUSES = ["sent", "delivered", "opened", "clicked", "completed"] as const;

export async function getRequestAnalytics(storeId: string, range: AnalyticsDateRange): Promise<RequestAnalytics> {
  const start = rangeStart(range);
  const createdAtFilter = start ? { gte: start } : undefined;
  const baseWhere = { storeId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) };

  const [statusGroups, createdDates] = await Promise.all([
    prisma.reviewRequest.groupBy({ by: ["status"], where: baseWhere, _count: { status: true } }),
    prisma.reviewRequest.findMany({ where: baseWhere, select: { createdAt: true } }),
  ]);

  const countByStatus = new Map(statusGroups.map((group) => [group.status, group._count.status]));
  const totalRequests = statusGroups.reduce((sum, group) => sum + group._count.status, 0);
  const sent = SENT_STATUSES.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0);
  const completed = countByStatus.get("completed") ?? 0;

  const earliestCreatedAt = createdDates.reduce<Date | null>(
    (earliest, row) => (!earliest || row.createdAt < earliest ? row.createdAt : earliest),
    null,
  );
  const trendStart = start ?? earliestCreatedAt;

  return {
    range,
    totalRequests,
    sent,
    completed,
    completionRate: sent > 0 ? completed / sent : 0,
    trend: trendStart ? bucketByDay(createdDates.map((row) => row.createdAt), trendStart) : [],
  };
}

export interface ConversionInsights {
  range: AnalyticsDateRange;
  // Hours between a request being sent and the customer actually submitting a review —
  // real, computed from ReviewRequest.sentAt/reviewedAt, which were already being stored
  // but never aggregated into a metric before this. null when no request in range has both
  // timestamps yet (nothing completed).
  averageTimeToConversionHours: number | null;
  bySource: Array<{ source: string; sent: number; completed: number; completionRate: number }>;
  byDelayBucket: Array<{ bucket: string; sent: number; completed: number; completionRate: number }>;
}

const DELAY_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: "Immediate (0 days)", min: 0, max: 0 },
  { label: "1–3 days", min: 1, max: 3 },
  { label: "4–7 days", min: 4, max: 7 },
  { label: "8+ days", min: 8, max: null },
];

function bucketForDelay(delayDays: number | null): string | null {
  if (delayDays === null) return null;
  const bucket = DELAY_BUCKETS.find((b) => delayDays >= b.min && (b.max === null || delayDays <= b.max));
  return bucket?.label ?? null;
}

// PRO. Every figure here is derived from ReviewRequest rows already in the database —
// nothing new is collected, this just aggregates sentAt/reviewedAt/source/delayDays
// (already-stored columns) into insights the Free tier's single completionRate doesn't
// break out.
export async function getConversionInsights(storeId: string, range: AnalyticsDateRange): Promise<ConversionInsights> {
  const start = rangeStart(range);
  const createdAtFilter = start ? { gte: start } : undefined;
  const baseWhere = { storeId, ...(createdAtFilter ? { createdAt: createdAtFilter } : {}) };

  const requests = await prisma.reviewRequest.findMany({
    where: baseWhere,
    select: { status: true, source: true, delayDays: true, sentAt: true, reviewedAt: true },
  });

  const conversionDurationsMs = requests
    .filter((r) => r.status === "completed" && r.sentAt && r.reviewedAt)
    .map((r) => r.reviewedAt!.getTime() - r.sentAt!.getTime())
    .filter((ms) => ms >= 0);

  const averageTimeToConversionHours =
    conversionDurationsMs.length > 0
      ? Number((conversionDurationsMs.reduce((sum, ms) => sum + ms, 0) / conversionDurationsMs.length / 3_600_000).toFixed(1))
      : null;

  const isSent = (status: string) => (SENT_STATUSES as readonly string[]).includes(status);

  const sourceMap = new Map<string, { sent: number; completed: number }>();
  const bucketMap = new Map<string, { sent: number; completed: number }>();

  for (const request of requests) {
    if (!isSent(request.status)) continue;

    const sourceEntry = sourceMap.get(request.source) ?? { sent: 0, completed: 0 };
    sourceEntry.sent += 1;
    if (request.status === "completed") sourceEntry.completed += 1;
    sourceMap.set(request.source, sourceEntry);

    const bucketLabel = bucketForDelay(request.delayDays);
    if (bucketLabel) {
      const bucketEntry = bucketMap.get(bucketLabel) ?? { sent: 0, completed: 0 };
      bucketEntry.sent += 1;
      if (request.status === "completed") bucketEntry.completed += 1;
      bucketMap.set(bucketLabel, bucketEntry);
    }
  }

  return {
    range,
    averageTimeToConversionHours,
    bySource: Array.from(sourceMap.entries()).map(([source, { sent, completed }]) => ({
      source,
      sent,
      completed,
      completionRate: sent > 0 ? completed / sent : 0,
    })),
    byDelayBucket: DELAY_BUCKETS.map((bucket) => {
      const entry = bucketMap.get(bucket.label) ?? { sent: 0, completed: 0 };
      return {
        bucket: bucket.label,
        sent: entry.sent,
        completed: entry.completed,
        completionRate: entry.sent > 0 ? entry.completed / entry.sent : 0,
      };
    }),
  };
}

export interface AiInsightsDigestEntry {
  productId: string;
  productName: string;
  recommendation: string;
  positives: string[];
  negatives: string[];
  reviewCountUsed: number;
  generatedAt: Date;
}

const AI_DIGEST_LIMIT = 10;

// PRO. Reuses already-generated ProductAiSummary rows (see aiSummary.server.ts) — never
// triggers new AI generation, never fabricates a summary; this is purely a digest view over
// data that already exists.
export async function getAiInsightsDigest(storeId: string): Promise<AiInsightsDigestEntry[]> {
  const rows = await prisma.productAiSummary.findMany({
    where: { product: { storeId } },
    orderBy: { generatedAt: "desc" },
    take: AI_DIGEST_LIMIT,
    include: { product: { select: { id: true, name: true } } },
  });

  const safeParseStringArray = (raw: string): string[] => {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  };

  return rows.map((row) => ({
    productId: row.product.id,
    productName: row.product.name,
    recommendation: row.recommendation,
    positives: safeParseStringArray(row.positives),
    negatives: safeParseStringArray(row.negatives),
    reviewCountUsed: row.reviewCountUsed,
    generatedAt: row.generatedAt,
  }));
}
