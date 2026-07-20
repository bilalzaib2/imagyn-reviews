import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { maybeAutoRegenerateAiSummary } from "./aiSummary.server";
import { HelpfulVoteValue, ReviewStatus } from "./review.shared";

export { HelpfulVoteValue, ReviewStatus };

const RATING_MIN = 1;
const RATING_MAX = 5;

const reviewInclude = {
  product: {
    select: { id: true, name: true, featuredImage: true },
  },
} satisfies Prisma.ReviewInclude;

export type ReviewWithProduct = Prisma.ReviewGetPayload<{ include: typeof reviewInclude }>;

export interface ReviewQueryOptions {
  search?: string;
  status?: ReviewStatus;
  rating?: number;
  product?: string;
  dateFrom?: string;
  dateTo?: string;
  verifiedPurchase?: boolean;
  cursor?: string;
  limit?: number;
  // Admin moderation sort only — a plain DB-level ORDER BY, distinct from the storefront's
  // Wilson-score "Most Helpful" ranking (rankByHelpfulness), which needs recency weighting
  // a merchant moderation queue has no reason to apply.
  sort?: "newest" | "helpful";
}

export interface ReviewQueryResult {
  reviews: ReviewWithProduct[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export interface CreateReviewInput {
  productId: string;
  rating: number;
  title?: string | null;
  content: string;
  reviewerName: string;
  reviewerEmail?: string | null;
  reviewerLocation?: string | null;
  verifiedPurchase?: boolean;
  featured?: boolean;
  photoUrls?: string | null;
}

export interface UpdateReviewInput {
  productId?: string;
  rating?: number;
  title?: string | null;
  content?: string;
  reviewerName?: string;
  reviewerEmail?: string | null;
  reviewerLocation?: string | null;
  verifiedPurchase?: boolean;
  featured?: boolean;
  photoUrls?: string | null;
}

function validateReviewInput(input: { rating: number; content: string; reviewerName: string }) {
  if (!Number.isInteger(input.rating) || input.rating < RATING_MIN || input.rating > RATING_MAX) {
    throw new Error("Rating must be a whole number between 1 and 5.");
  }

  if (!input.reviewerName || input.reviewerName.trim().length === 0) {
    throw new Error("Reviewer name is required.");
  }

  if (!input.content || input.content.trim().length === 0) {
    throw new Error("Review content is required.");
  }
}

async function requireReview(id: string) {
  const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

  if (!existing) {
    throw new Error("Review not found.");
  }

  return existing;
}

export async function recalculateProductStats(productId: string) {
  const [totalReviews, aggregate, ratingGroups] = await Promise.all([
    prisma.review.count({ where: { productId, deletedAt: null } }),
    prisma.review.aggregate({
      where: { productId, deletedAt: null },
      _avg: { rating: true },
    }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { productId, deletedAt: null },
      _count: { rating: true },
    }),
  ]);

  const countByRating = new Map(ratingGroups.map((group) => [group.rating, group._count.rating]));

  return prisma.product.update({
    where: { id: productId },
    data: {
      totalReviews,
      averageRating: Number((aggregate._avg.rating ?? 0).toFixed(1)),
      rating5Count: countByRating.get(5) ?? 0,
      rating4Count: countByRating.get(4) ?? 0,
      rating3Count: countByRating.get(3) ?? 0,
      rating2Count: countByRating.get(2) ?? 0,
      rating1Count: countByRating.get(1) ?? 0,
    },
  });
}

async function queryReviews(
  baseWhere: Prisma.ReviewWhereInput,
  options: ReviewQueryOptions = {},
): Promise<ReviewQueryResult> {
  const limit = options.limit ?? 20;

  const where: Prisma.ReviewWhereInput = {
    ...baseWhere,
    deletedAt: null,
    ...(options.status ? { status: options.status } : {}),
    ...(options.rating != null ? { rating: options.rating } : {}),
    ...(options.verifiedPurchase != null ? { verifiedPurchase: options.verifiedPurchase } : {}),
    ...(options.dateFrom || options.dateTo
      ? {
          createdAt: {
            ...(options.dateFrom ? { gte: new Date(options.dateFrom) } : {}),
            ...(options.dateTo ? { lte: new Date(`${options.dateTo}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(options.search
      ? {
          OR: [
            { title: { contains: options.search } },
            { content: { contains: options.search } },
            { reviewerName: { contains: options.search } },
          ],
        }
      : {}),
    ...(options.product ? { product: { name: { contains: options.product } } } : {}),
  };

  const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
    options.sort === "helpful"
      ? [{ helpfulCount: "desc" }, { createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];

  const [totalCount, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      include: reviewInclude,
      orderBy,
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = reviews.length > limit;
  const pagedReviews = hasMore ? reviews.slice(0, limit) : reviews;

  return {
    reviews: pagedReviews,
    nextCursor: hasMore && pagedReviews.length > 0 ? pagedReviews[pagedReviews.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

export async function getStoreReviews(storeId: string, options: ReviewQueryOptions = {}) {
  return queryReviews({ storeId }, options);
}

export async function getProductReviews(productId: string, options: ReviewQueryOptions = {}) {
  return queryReviews({ productId }, options);
}

export interface StoreReviewStats {
  totalReviews: number;
  publishedReviews: number;
  pendingReviews: number;
  averageRating: number;
  recentReviews: ReviewWithProduct[];
}

// Store-wide dashboard stats, queried directly off the Review table with the same
// deletedAt/status scoping every other review query in this file already uses — there is
// no separate cached counter anywhere (Product.totalReviews/rating*Count are per-product,
// all-status aggregates written by recalculateProductStats for a different purpose, and
// were never status-broken-down, so they can't answer "how many are pending" at all).
// averageRating is computed from APPROVED reviews only, matching what getPublicReviewSummary
// shows on the storefront — the dashboard's number and the storefront's number are always
// the same query shape, just aggregated store-wide instead of per-product.
export async function getStoreReviewStats(storeId: string, options: { recentLimit?: number } = {}): Promise<StoreReviewStats> {
  const recentLimit = options.recentLimit ?? 5;

  const [totalReviews, statusGroups, approvedAggregate, recentReviews] = await Promise.all([
    prisma.review.count({ where: { storeId, deletedAt: null } }),
    prisma.review.groupBy({
      by: ["status"],
      where: { storeId, deletedAt: null },
      _count: { status: true },
    }),
    prisma.review.aggregate({
      where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED },
      _avg: { rating: true },
    }),
    prisma.review.findMany({
      where: { storeId, deletedAt: null },
      include: reviewInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: recentLimit,
    }),
  ]);

  const countByStatus = new Map(statusGroups.map((group) => [group.status, group._count.status]));

  return {
    totalReviews,
    publishedReviews: countByStatus.get(ReviewStatus.APPROVED) ?? 0,
    pendingReviews: countByStatus.get(ReviewStatus.PENDING) ?? 0,
    averageRating: Number((approvedAggregate._avg.rating ?? 0).toFixed(1)),
    recentReviews,
  };
}

export interface PublicReviewSummary {
  averageRating: number;
  totalReviews: number;
  // Optional: only getPublicReviewSummary (single-product, Review Summary widget) computes
  // the per-star breakdown. getPublicReviewSummaryBatch (collection/search badge grids)
  // doesn't need it, so it isn't required there.
  ratingCounts?: { 1: number; 2: number; 3: number; 4: number; 5: number };
}

// Scoped to APPROVED + non-deleted only, independent of recalculateProductStats (which
// intentionally counts every status for internal merchant reporting, and whose stored
// Product.rating5Count..rating1Count therefore can't be reused here — they'd leak
// pending/rejected counts into a public response). Used for public, unauthenticated
// storefront display, where pending/rejected reviews must never surface.
export async function getPublicReviewSummary(productId: string): Promise<PublicReviewSummary> {
  const [totalReviews, aggregate, ratingGroups] = await Promise.all([
    prisma.review.count({ where: { productId, deletedAt: null, status: ReviewStatus.APPROVED } }),
    prisma.review.aggregate({
      where: { productId, deletedAt: null, status: ReviewStatus.APPROVED },
      _avg: { rating: true },
    }),
    prisma.review.groupBy({
      by: ["rating"],
      where: { productId, deletedAt: null, status: ReviewStatus.APPROVED },
      _count: { rating: true },
    }),
  ]);

  const countByRating = new Map(ratingGroups.map((group) => [group.rating, group._count.rating]));

  return {
    averageRating: Number((aggregate._avg.rating ?? 0).toFixed(1)),
    totalReviews,
    ratingCounts: {
      5: countByRating.get(5) ?? 0,
      4: countByRating.get(4) ?? 0,
      3: countByRating.get(3) ?? 0,
      2: countByRating.get(2) ?? 0,
      1: countByRating.get(1) ?? 0,
    },
  };
}

// Batched counterpart of getPublicReviewSummary — one groupBy query for many products
// instead of N queries, for rendering rating badges across a collection/search grid.
export async function getPublicReviewSummaryBatch(
  productIds: string[],
): Promise<Record<string, PublicReviewSummary>> {
  const summaries: Record<string, PublicReviewSummary> = {};

  if (productIds.length === 0) {
    return summaries;
  }

  const groups = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, deletedAt: null, status: ReviewStatus.APPROVED },
    _avg: { rating: true },
    _count: { rating: true },
  });

  for (const group of groups) {
    summaries[group.productId] = {
      averageRating: Number((group._avg.rating ?? 0).toFixed(1)),
      totalReviews: group._count.rating,
    };
  }

  return summaries;
}

export async function getReview(id: string) {
  return prisma.review.findFirst({
    where: { id, deletedAt: null },
    include: reviewInclude,
  });
}

export async function createReview(data: CreateReviewInput) {
  const product = await prisma.product.findUnique({
    where: { id: data.productId },
    select: { id: true, storeId: true, name: true },
  });

  if (!product) {
    throw new Error("Product not found.");
  }

  validateReviewInput(data);

  const review = await prisma.review.create({
    data: {
      storeId: product.storeId,
      productId: product.id,
      productTitle: product.name,
      rating: data.rating,
      title: data.title?.trim() || null,
      content: data.content.trim(),
      reviewerName: data.reviewerName.trim(),
      reviewerEmail: data.reviewerEmail?.trim() || null,
      reviewerLocation: data.reviewerLocation?.trim() || null,
      verifiedPurchase: data.verifiedPurchase ?? false,
      featured: data.featured ?? false,
      photoUrls: data.photoUrls || null,
    },
    include: reviewInclude,
  });

  await recalculateProductStats(product.id);

  return review;
}

// Status changes (PENDING/APPROVED/REJECTED) are deliberately not accepted here and go
// through approveReview/rejectReview instead, so the moderation workflow has one entry point.
export async function updateReview(id: string, data: UpdateReviewInput) {
  const existing = await requireReview(id);

  const nextRating = data.rating ?? existing.rating;
  const nextContent = data.content ?? existing.content;
  const nextReviewerName = data.reviewerName ?? existing.reviewerName;

  validateReviewInput({ rating: nextRating, content: nextContent, reviewerName: nextReviewerName });

  let nextStoreId = existing.storeId;
  let nextProductId = existing.productId;
  let nextProductTitle = existing.productTitle;

  if (data.productId && data.productId !== existing.productId) {
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      select: { id: true, storeId: true, name: true },
    });

    if (!product) {
      throw new Error("Product not found.");
    }

    nextProductId = product.id;
    nextStoreId = product.storeId;
    nextProductTitle = product.name;
  }

  const review = await prisma.review.update({
    where: { id },
    data: {
      storeId: nextStoreId,
      productId: nextProductId,
      productTitle: nextProductTitle,
      rating: nextRating,
      content: nextContent.trim(),
      reviewerName: nextReviewerName.trim(),
      ...(data.title !== undefined ? { title: data.title?.trim() || null } : {}),
      ...(data.reviewerEmail !== undefined ? { reviewerEmail: data.reviewerEmail?.trim() || null } : {}),
      ...(data.reviewerLocation !== undefined ? { reviewerLocation: data.reviewerLocation?.trim() || null } : {}),
      ...(data.verifiedPurchase !== undefined ? { verifiedPurchase: data.verifiedPurchase } : {}),
      ...(data.featured !== undefined ? { featured: data.featured } : {}),
      ...(data.photoUrls !== undefined ? { photoUrls: data.photoUrls } : {}),
    },
    include: reviewInclude,
  });

  await recalculateProductStats(nextProductId);

  if (existing.productId !== nextProductId) {
    await recalculateProductStats(existing.productId);
  }

  return review;
}

export async function deleteReview(id: string) {
  const existing = await requireReview(id);

  const review = await prisma.review.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: reviewInclude,
  });

  await recalculateProductStats(existing.productId);

  return review;
}

async function setReviewStatus(id: string, status: typeof ReviewStatus.APPROVED | typeof ReviewStatus.REJECTED) {
  const existing = await requireReview(id);

  const review = await prisma.review.update({
    where: { id },
    data: { status, isPublished: status === ReviewStatus.APPROVED },
    include: reviewInclude,
  });

  await recalculateProductStats(existing.productId);

  // Fire-and-forget: never awaited, so this moderation action always returns immediately
  // regardless of AI latency. maybeAutoRegenerateAiSummary does its own threshold check
  // and only actually calls the AI provider when enough new approved reviews warrant it.
  if (status === ReviewStatus.APPROVED) {
    void maybeAutoRegenerateAiSummary(existing.productId);
  }

  return review;
}

export async function approveReview(id: string) {
  return setReviewStatus(id, ReviewStatus.APPROVED);
}

export async function rejectReview(id: string) {
  return setReviewStatus(id, ReviewStatus.REJECTED);
}

export async function replyToReview(id: string, reply: string) {
  await requireReview(id);

  const trimmedReply = reply.trim();

  if (!trimmedReply) {
    throw new Error("Reply cannot be empty.");
  }

  return prisma.review.update({
    where: { id },
    data: { reply: trimmedReply, repliedAt: new Date() },
    include: reviewInclude,
  });
}

export async function deleteReply(id: string) {
  await requireReview(id);

  return prisma.review.update({
    where: { id },
    data: { reply: null, repliedAt: null },
    include: reviewInclude,
  });
}

async function distinctProductIdsFor(ids: string[]) {
  const reviews = await prisma.review.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { productId: true },
  });

  return Array.from(new Set(reviews.map((review) => review.productId)));
}

export async function bulkModerateReviews(
  ids: string[],
  status: typeof ReviewStatus.APPROVED | typeof ReviewStatus.REJECTED,
) {
  if (ids.length === 0) {
    return { count: 0 };
  }

  const affectedProductIds = await distinctProductIdsFor(ids);

  const result = await prisma.review.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { status, isPublished: status === ReviewStatus.APPROVED },
  });

  await Promise.all(affectedProductIds.map((productId) => recalculateProductStats(productId)));

  if (status === ReviewStatus.APPROVED) {
    affectedProductIds.forEach((productId) => void maybeAutoRegenerateAiSummary(productId));
  }

  return result;
}

export async function bulkDeleteReviews(ids: string[]) {
  if (ids.length === 0) {
    return { count: 0 };
  }

  const affectedProductIds = await distinctProductIdsFor(ids);

  const result = await prisma.review.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  await Promise.all(affectedProductIds.map((productId) => recalculateProductStats(productId)));

  return result;
}

export interface HelpfulVoteResult {
  helpfulCount: number;
  notHelpfulCount: number;
  vote: HelpfulVoteValue;
}

// Only APPROVED, non-deleted reviews are votable — matches the same public-visibility
// rule every other storefront-facing query in this file already enforces. The unique
// (reviewId, visitorId) constraint on ReviewHelpfulVote is what actually guarantees
// "exactly one vote per visitor, can change it" — this upsert is just the one operation
// that constraint allows. Counts are always recomputed from the vote rows themselves
// inside the same transaction as the upsert (never incremented ad hoc), so a race between
// two concurrent votes can't produce a count that doesn't match what's actually stored —
// this is the "never trust client-side counts" rule applied server-side too.
export async function castHelpfulVote(
  reviewId: string,
  visitorId: string,
  vote: HelpfulVoteValue,
): Promise<HelpfulVoteResult> {
  if (!visitorId) {
    throw new Error("A visitor identifier is required.");
  }

  return prisma.$transaction(async (tx) => {
    const review = await tx.review.findFirst({
      where: { id: reviewId, deletedAt: null, status: ReviewStatus.APPROVED },
      select: { id: true },
    });

    if (!review) {
      throw new Error("Review not found.");
    }

    await tx.reviewHelpfulVote.upsert({
      where: { reviewId_visitorId: { reviewId, visitorId } },
      update: { vote },
      create: { reviewId, visitorId, vote },
    });

    const [helpfulCount, notHelpfulCount] = await Promise.all([
      tx.reviewHelpfulVote.count({ where: { reviewId, vote: HelpfulVoteValue.HELPFUL } }),
      tx.reviewHelpfulVote.count({ where: { reviewId, vote: HelpfulVoteValue.NOT_HELPFUL } }),
    ]);

    await tx.review.update({
      where: { id: reviewId },
      data: { helpfulCount, notHelpfulCount },
    });

    return { helpfulCount, notHelpfulCount, vote };
  });
}

// Batched lookup of one visitor's existing votes across many reviews — used by the public
// reviews endpoint to annotate each review with the requesting visitor's own vote (if
// any), so a returning shopper sees their prior choice reflected instead of a blank state.
export async function getVisitorVotes(
  reviewIds: string[],
  visitorId: string | null | undefined,
): Promise<Record<string, HelpfulVoteValue>> {
  if (!visitorId || reviewIds.length === 0) {
    return {};
  }

  const votes = await prisma.reviewHelpfulVote.findMany({
    where: { reviewId: { in: reviewIds }, visitorId },
    select: { reviewId: true, vote: true },
  });

  const result: Record<string, HelpfulVoteValue> = {};
  for (const { reviewId, vote } of votes) {
    result[reviewId] = vote as HelpfulVoteValue;
  }
  return result;
}

function wilsonLowerBound(positive: number, total: number): number {
  if (total === 0) return 0;

  const z = 1.96; // 95% confidence
  const phat = positive / total;

  return (
    (phat + (z * z) / (2 * total) - z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total)) /
    (1 + (z * z) / total)
  );
}

const HELPFUL_RANK_HALF_LIFE_DAYS = 180;

function ageDecay(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / HELPFUL_RANK_HALF_LIFE_DAYS);
}

function helpfulnessScore(review: { helpfulCount: number; notHelpfulCount: number; createdAt: Date }): number {
  const total = review.helpfulCount + review.notHelpfulCount;
  const quality = wilsonLowerBound(review.helpfulCount, total);
  // Blended 70/30 rather than a straight multiply: a genuinely well-regarded old review
  // stays visible instead of decaying to near-zero, while two reviews of comparable
  // quality still favor the more recent one — "avoid older reviews permanently
  // dominating" without making them disappear outright.
  return quality * (0.7 + 0.3 * ageDecay(review.createdAt));
}

// "Most Helpful" sort for the public storefront widget. Deliberately not a stored/DB-
// ordered column: the widget fetches its full review batch (capped at 50, see
// getProductReviews's limit in api.reviews.tsx) in one request and re-sorts it here,
// so this only ever runs over a small, already-fetched array — no pagination concerns.
// The admin's "sort by Helpful" is a separate, simpler `ORDER BY helpfulCount DESC` at
// the query level (see queryReviews) because that view paginates over a store's entire
// review history and doesn't need Wilson-score sophistication for a moderation queue.
export function rankByHelpfulness<T extends { helpfulCount: number; notHelpfulCount: number; createdAt: Date }>(
  reviews: T[],
): T[] {
  return [...reviews].sort((a, b) => helpfulnessScore(b) - helpfulnessScore(a));
}
