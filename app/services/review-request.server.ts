import prisma from "../db.server";

export type ReviewRequestStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "opened"
  | "reviewed"
  | "failed"
  | "cancelled";

export type ReviewRequestDateFilter = "all" | "today" | "next7" | "next30" | "past30";

export interface ReviewRequestListOptions {
  search?: string;
  status?: ReviewRequestStatus;
  dateFilter?: ReviewRequestDateFilter;
  page?: number;
  pageSize?: number;
}

export interface ReviewRequestRecord {
  id: string;
  name: string | null;
  email: string | null;
  orderNumber: string | null;
  customMessage: string | null;
  requestToken: string | null;
  delayDays: number | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
  openedAt: Date | null;
  reviewedAt: Date | null;
  status: ReviewRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  store: { id: string; name: string };
  product: { id: string; name: string | null } | null;
}

export interface ReviewRequestListResult {
  requests: ReviewRequestRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
}

const buildScheduledFor = (delayDays: number) => {
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + delayDays);
  return scheduledFor;
};

const mapRequestRecord = (request: {
  id: string;
  name: string | null;
  email: string | null;
  orderNumber: string | null;
  customMessage: string | null;
  requestToken: string | null;
  delayDays: number | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
  openedAt: Date | null;
  reviewedAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  store: { id: string; name: string };
  product: { id: string; name: string | null } | null;
}): ReviewRequestRecord => ({
  id: request.id,
  name: request.name,
  email: request.email,
  orderNumber: request.orderNumber,
  customMessage: request.customMessage,
  requestToken: request.requestToken,
  delayDays: request.delayDays,
  scheduledFor: request.scheduledFor,
  sentAt: request.sentAt,
  openedAt: request.openedAt,
  reviewedAt: request.reviewedAt,
  status: request.status as ReviewRequestStatus,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  store: request.store,
  product: request.product,
});

const buildDateWhere = (dateFilter?: ReviewRequestDateFilter) => {
  if (!dateFilter || dateFilter === "all") {
    return {};
  }

  const now = new Date();

  if (dateFilter === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return {
      OR: [{ scheduledFor: { gte: start, lte: end } }, { createdAt: { gte: start, lte: end } }],
    };
  }

  if (dateFilter === "next7" || dateFilter === "next30") {
    const days = dateFilter === "next7" ? 7 : 30;
    const end = new Date(now);
    end.setDate(end.getDate() + days);

    return {
      scheduledFor: { gte: now, lte: end },
    };
  }

  const start = new Date(now);
  start.setDate(start.getDate() - 30);

  return {
    createdAt: { gte: start, lte: now },
  };
};

const buildDeliveryPayload = (request: ReviewRequestRecord) => ({
  requestId: request.id,
  customerName: request.name,
  customerEmail: request.email,
  productId: request.product?.id ?? null,
  productName: request.product?.name ?? null,
  orderNumber: request.orderNumber,
  customMessage: request.customMessage,
  scheduledFor: request.scheduledFor,
  requestToken: request.requestToken,
});

export const reviewRequestService = {
  async listRequests(options: ReviewRequestListOptions = {}): Promise<ReviewRequestListResult> {
    const pageSize = options.pageSize ?? 10;
    const page = Math.max(options.page ?? 1, 1);

    const where = {
      ...(options.status ? { status: options.status } : {}),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search } },
              { email: { contains: options.search } },
              { orderNumber: { contains: options.search } },
              { product: { name: { contains: options.search } } },
            ],
          }
        : {}),
      ...buildDateWhere(options.dateFilter),
    };

    const [totalCount, requests] = await Promise.all([
      prisma.reviewRequest.count({ where }),
      prisma.reviewRequest.findMany({
        where,
        include: {
          store: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      requests: requests.map(mapRequestRecord),
      totalCount,
      page,
      pageSize,
    };
  },

  async getRequest(id: string) {
    const request = await prisma.reviewRequest.findUnique({
      where: { id },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    return request ? mapRequestRecord(request) : null;
  },

  async listProducts() {
    return prisma.product.findMany({
      select: { id: true, name: true, storeId: true },
      orderBy: { name: "asc" },
    });
  },

  async listCustomers() {
    return prisma.review.findMany({
      where: {
        deletedAt: null,
        reviewerEmail: { not: null },
      },
      select: {
        reviewerName: true,
        reviewerEmail: true,
      },
      distinct: ["reviewerEmail"],
      orderBy: { reviewerEmail: "asc" },
    });
  },

  async createRequest(data: {
    productId: string;
    email: string;
    name: string;
    orderNumber?: string | null;
    customMessage?: string | null;
    delayDays: number;
    status?: ReviewRequestStatus;
  }) {
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      select: { id: true, storeId: true, name: true },
    });

    if (!product) {
      throw new Error("Product not found.");
    }

    const normalizedDelay = Math.max(data.delayDays, 0);
    const status: ReviewRequestStatus = data.status ?? (normalizedDelay === 0 ? "sending" : "scheduled");

    const created = await prisma.reviewRequest.create({
      data: {
        storeId: product.storeId,
        productId: product.id,
        email: data.email.trim(),
        name: data.name.trim(),
        orderNumber: data.orderNumber?.trim() || null,
        customMessage: data.customMessage?.trim() || null,
        delayDays: normalizedDelay,
        scheduledFor: buildScheduledFor(normalizedDelay),
        requestToken: crypto.randomUUID(),
        status,
        ...(status === "sending" ? { sentAt: new Date() } : {}),
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    return {
      request: mapRequestRecord(created),
      delivery: buildDeliveryPayload(mapRequestRecord(created)),
    };
  },

  async updateRequest(id: string, data: {
    productId?: string | null;
    email?: string | null;
    name?: string | null;
    orderNumber?: string | null;
    customMessage?: string | null;
    delayDays?: number | null;
    status?: ReviewRequestStatus;
  }) {
    const existing = await prisma.reviewRequest.findUnique({ where: { id } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    const nextDelay = data.delayDays == null ? existing.delayDays : Math.max(data.delayDays, 0);

    return prisma.reviewRequest.update({
      where: { id },
      data: {
        ...(data.productId !== undefined ? { productId: data.productId } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.name !== undefined ? { name: data.name?.trim() || null } : {}),
        ...(data.orderNumber !== undefined ? { orderNumber: data.orderNumber?.trim() || null } : {}),
        ...(data.customMessage !== undefined ? { customMessage: data.customMessage?.trim() || null } : {}),
        ...(nextDelay !== undefined
          ? {
              delayDays: nextDelay,
              scheduledFor: nextDelay == null ? existing.scheduledFor : buildScheduledFor(nextDelay),
            }
          : {}),
        ...(data.status ? { status: data.status } : {}),
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }).then(mapRequestRecord);
  },

  async rescheduleRequest(id: string, delayDays: number) {
    const existing = await prisma.reviewRequest.findUnique({ where: { id } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    return prisma.reviewRequest.update({
      where: { id },
      data: {
        delayDays,
        scheduledFor: buildScheduledFor(delayDays),
        status: "scheduled",
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }).then(mapRequestRecord);
  },

  async resendRequest(id: string) {
    const existing = await prisma.reviewRequest.findUnique({ where: { id } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    const nextDelay = existing.delayDays ?? 0;

    return prisma.reviewRequest.update({
      where: { id },
      data: {
        status: nextDelay === 0 ? "sending" : "scheduled",
        delayDays: nextDelay,
        scheduledFor: buildScheduledFor(nextDelay),
        sentAt: nextDelay === 0 ? new Date() : existing.sentAt,
        requestToken: crypto.randomUUID(),
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }).then(mapRequestRecord);
  },

  async cancelRequest(id: string) {
    const existing = await prisma.reviewRequest.findUnique({ where: { id } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    return prisma.reviewRequest.update({
      where: { id },
      data: { status: "cancelled" },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }).then(mapRequestRecord);
  },

  async deleteRequest(id: string) {
    const existing = await prisma.reviewRequest.findUnique({ where: { id } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    return prisma.reviewRequest.delete({ where: { id } });
  },
};