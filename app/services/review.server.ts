import type { Prisma } from "@prisma/client";
import prisma from "../db.server";

const normalizeReviewInput = (input: {
  title?: string | null;
  body?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
  merchantReply?: string | null;
  rating?: number | null;
  status?: string | null;
  productId?: string | null;
  photoUrls?: string | null;
  verifiedPurchase?: boolean | null;
}) => {
  const title = input.title?.trim();
  const body = input.body?.trim();
  const authorName = input.authorName?.trim();
  const authorEmail = input.authorEmail?.trim();
  const merchantReply = input.merchantReply?.trim();
  const rating = input.rating == null ? null : Number(input.rating);
  const status = input.status?.trim() || "pending";

  return {
    title: title || null,
    body: body || null,
    authorName: authorName || null,
    authorEmail: authorEmail || null,
    merchantReply: merchantReply || null,
    rating: Number.isFinite(rating) ? rating : null,
    status,
    productId: input.productId || null,
    photoUrls: input.photoUrls || null,
    verifiedPurchase: input.verifiedPurchase ?? false,
  };
};

export interface ReviewQueryOptions {
  storeId?: string;
  productId?: string;
  search?: string;
  status?: string;
  rating?: number;
  product?: string;
  dateFrom?: string;
  dateTo?: string;
  verifiedPurchase?: boolean;
  cursor?: string;
  limit?: number;
}

type ReviewWithProduct = Prisma.ReviewGetPayload<{ include: { product: true } }>;

export interface ReviewQueryResult {
  reviews: Array<{
    id: string;
    title: string | null;
    body: string | null;
    authorName: string | null;
    authorEmail: string | null;
    merchantReply: string | null;
    repliedAt: Date | null;
    rating: number | null;
    status: string;
    verifiedPurchase: boolean;
    photoUrls: string | null;
    createdAt: Date;
    product: { id: string; name: string | null } | null;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export const reviewService = {
  async getDashboardStats() {
    const [aggregates, totalReviews, pendingReviews, verifiedReviews] = await Promise.all([
      prisma.review.aggregate({
        where: { deletedAt: null },
        _avg: { rating: true },
      }),
      prisma.review.count({ where: { deletedAt: null } }),
      prisma.review.count({ where: { deletedAt: null, status: "pending" } }),
      prisma.review.count({ where: { deletedAt: null, verifiedPurchase: true } }),
    ]);

    const averageRating = Number((aggregates._avg.rating ?? 0).toFixed(1));
    const verifiedPurchaseRate = totalReviews === 0 ? 0 : Math.round((verifiedReviews / totalReviews) * 100);

    return {
      averageRating,
      totalReviews,
      pendingReviews,
      verifiedPurchaseRate,
    };
  },

  async getProductStats(productId: string) {
    const [totalCount, aggregate] = await Promise.all([
      prisma.review.count({ where: { productId, deletedAt: null } }),
      prisma.review.aggregate({
        where: { productId, deletedAt: null },
        _avg: { rating: true },
      }),
    ]);

    return {
      totalCount,
      averageRating: Number((aggregate._avg.rating ?? 0).toFixed(1)),
    };
  },

  async list(storeId?: string, productId?: string) {
    return prisma.review.findMany({
      where: {
        deletedAt: null,
        ...(storeId ? { storeId } : {}),
        ...(productId ? { productId } : {}),
      },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
  },

  async query(options: ReviewQueryOptions = {}): Promise<ReviewQueryResult> {
    const limit = options.limit ?? 20;
    const where: Prisma.ReviewWhereInput = {
      deletedAt: null,
      ...(options.storeId ? { storeId: options.storeId } : {}),
      ...(options.productId ? { productId: options.productId } : {}),
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
              { body: { contains: options.search } },
              { authorName: { contains: options.search } },
            ],
          }
        : {}),
      ...(options.product
        ? {
            product: {
              name: { contains: options.product },
            },
          }
        : {}),
    };

    const [totalCount, reviews] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        include: { product: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      }),
    ]);

    const hasMore = reviews.length > limit;
    const pagedReviews = hasMore ? reviews.slice(0, limit) : reviews;

    return {
      reviews: pagedReviews.map((review: ReviewWithProduct) => ({
        id: review.id,
        title: review.title,
        body: review.body,
        authorName: review.authorName,
        authorEmail: review.authorEmail,
        merchantReply: review.merchantReply,
        repliedAt: review.repliedAt,
        rating: review.rating,
        status: review.status,
        verifiedPurchase: review.verifiedPurchase,
        photoUrls: review.photoUrls,
        createdAt: review.createdAt,
        product: review.product ? { id: review.product.id, name: review.product.name } : null,
      })),
      nextCursor: hasMore && pagedReviews.length > 0 ? pagedReviews[pagedReviews.length - 1].id : null,
      hasMore,
      totalCount,
    };
  },

  async getById(id: string) {
    return prisma.review.findFirst({
      where: { id, deletedAt: null },
      include: { product: true },
    });
  },

  async create(data: {
    storeId: string;
    productId?: string | null;
    authorName?: string | null;
    authorEmail?: string | null;
    merchantReply?: string | null;
    title?: string | null;
    body?: string | null;
    rating?: number | null;
    status?: string | null;
    photoUrls?: string | null;
    verifiedPurchase?: boolean | null;
  }) {
    const normalized = normalizeReviewInput(data);

    if (!data.storeId) {
      throw new Error("A storeId is required to create a review.");
    }

    if (normalized.title == null && normalized.body == null) {
      throw new Error("A review title or body is required.");
    }

    if (normalized.rating != null && (normalized.rating < 1 || normalized.rating > 5)) {
      throw new Error("Rating must be between 1 and 5.");
    }

    return prisma.review.create({
      data: {
        storeId: data.storeId,
        ...normalized,
      },
      include: { product: true },
    });
  },

  async update(id: string, data: {
    productId?: string | null;
    authorName?: string | null;
    authorEmail?: string | null;
    merchantReply?: string | null;
    title?: string | null;
    body?: string | null;
    rating?: number | null;
    status?: string | null;
    photoUrls?: string | null;
    verifiedPurchase?: boolean | null;
  }) {
    const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

    if (!existing) {
      throw new Error("Review not found.");
    }

    const normalized = normalizeReviewInput(data);

    if (normalized.rating != null && (normalized.rating < 1 || normalized.rating > 5)) {
      throw new Error("Rating must be between 1 and 5.");
    }

    return prisma.review.update({
      where: { id },
      data: normalized,
      include: { product: true },
    });
  },

  async moderateStatus(id: string, status: "pending" | "approved" | "rejected") {
    const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

    if (!existing) {
      throw new Error("Review not found.");
    }

    return prisma.review.update({
      where: { id },
      data: { status },
      include: { product: true },
    });
  },

  async approveReview(id: string) {
    return this.moderateStatus(id, "approved");
  },

  async rejectReview(id: string) {
    return this.moderateStatus(id, "rejected");
  },

  async replyToReview(id: string, merchantReply: string) {
    const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

    if (!existing) {
      throw new Error("Review not found.");
    }

    const normalizedReply = merchantReply.trim();

    if (!normalizedReply) {
      throw new Error("Reply cannot be empty.");
    }

    return prisma.review.update({
      where: { id },
      data: { merchantReply: normalizedReply, repliedAt: new Date() },
      include: { product: true },
    });
  },

  async updateReply(id: string, merchantReply: string) {
    const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

    if (!existing) {
      throw new Error("Review not found.");
    }

    const normalizedReply = merchantReply.trim();

    if (!normalizedReply) {
      throw new Error("Reply cannot be empty.");
    }

    return prisma.review.update({
      where: { id },
      data: { merchantReply: normalizedReply, repliedAt: new Date() },
      include: { product: true },
    });
  },

  async deleteReply(id: string) {
    const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

    if (!existing) {
      throw new Error("Review not found.");
    }

    return prisma.review.update({
      where: { id },
      data: { merchantReply: null, repliedAt: null },
      include: { product: true },
    });
  },

  async bulkModerate(ids: string[], status: "pending" | "approved" | "rejected") {
    if (ids.length === 0) {
      return { count: 0 };
    }

    return prisma.review.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { status },
    });
  },

  async bulkSoftDelete(ids: string[]) {
    if (ids.length === 0) {
      return { count: 0 };
    }

    return prisma.review.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  },

  async softDelete(id: string) {
    const existing = await prisma.review.findFirst({ where: { id, deletedAt: null } });

    if (!existing) {
      throw new Error("Review not found.");
    }

    return prisma.review.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: { product: true },
    });
  },
};
