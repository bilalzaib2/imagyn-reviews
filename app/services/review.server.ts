import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { ReviewStatus } from "./review.shared";

export { ReviewStatus };

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

  const [totalCount, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      include: reviewInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

export interface PublicReviewSummary {
  averageRating: number;
  totalReviews: number;
}

// Scoped to APPROVED + non-deleted only, independent of recalculateProductStats (which
// intentionally counts every status for internal merchant reporting). Used for public,
// unauthenticated storefront display, where pending/rejected reviews must never surface.
export async function getPublicReviewSummary(productId: string): Promise<PublicReviewSummary> {
  const [totalReviews, aggregate] = await Promise.all([
    prisma.review.count({ where: { productId, deletedAt: null, status: ReviewStatus.APPROVED } }),
    prisma.review.aggregate({
      where: { productId, deletedAt: null, status: ReviewStatus.APPROVED },
      _avg: { rating: true },
    }),
  ]);

  return {
    averageRating: Number((aggregate._avg.rating ?? 0).toFixed(1)),
    totalReviews,
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
