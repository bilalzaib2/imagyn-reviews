import prisma from "../db.server";
import { getEmailProvider } from "./notifications/provider.server";
import { buildReviewRequestEmail } from "./notifications/templates.server";

// Full lifecycle: pending -> scheduled -> sending -> sent -> delivered -> opened -> clicked
// -> completed, with failed/cancelled as terminal branches off any pre-completed state.
// "delivered" and "opened" (true email-open tracking) are populated only by a future Resend
// inbound webhook — defined here now so the admin UI and filters are ready for it, but no
// code in this pass ever sets them. "clicked" is what today's link-visit tracking actually
// observes (a customer following the emailed link), so it replaces the old "opened" value —
// see markRequestClicked below.
export type ReviewRequestStatus =
  | "pending"
  | "scheduled"
  | "sending"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "completed"
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
  source: string;
  shopifyOrderId: string | null;
  sendAttempts: number;
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
  source: string;
  shopifyOrderId: string | null;
  sendAttempts: number;
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
  source: request.source,
  shopifyOrderId: request.shopifyOrderId,
  sendAttempts: request.sendAttempts,
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

// How long a review link stays valid after it's sent — the resolver (app/routes/r.$token.tsx)
// rejects the token past this without needing a merchant-facing setting for the MVP.
const TOKEN_TTL_DAYS = 30;

const generateRequestToken = () => crypto.randomUUID();

const computeTokenExpiry = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + TOKEN_TTL_DAYS);
  return expiresAt;
};

const buildReviewUrl = (requestToken: string) => {
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000";
  return `${appUrl.replace(/\/$/, "")}/r/${requestToken}`;
};

// Bounded retry for a transient send failure (e.g. a momentary Resend/network error) — capped
// by a fixed constant so a persistently-failing provider can never loop forever. Only "failed"
// after every attempt is exhausted.
const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends the request email and reflects the outcome on the row — never throws, so a Resend
// error surfaces as status "failed" (visible in the admin UI) instead of crashing the
// create/resend action and losing the request entirely. Called either synchronously at create
// time (delayDays === 0) or via enqueueReviewRequestDispatch (reviewRequestDispatch.server.ts) —
// the seam a future queue worker will call once a scheduled request comes due.
export const dispatchRequestEmail = async (request: ReviewRequestRecord): Promise<ReviewRequestRecord> => {
  if (!request.email || !request.requestToken) {
    return request;
  }

  const { subject, html, text } = await buildReviewRequestEmail({
    customerName: request.name || "there",
    productName: request.product?.name || "your recent purchase",
    storeName: request.store.name,
    reviewUrl: buildReviewUrl(request.requestToken),
    customMessage: request.customMessage,
  });

  let lastError: unknown;

  for (let attempt = request.sendAttempts; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      await getEmailProvider().sendEmail({ to: request.email, subject, html, text });

      const updated = await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { status: "sent", sendAttempts: attempt + 1 },
        include: {
          store: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
      });

      return mapRequestRecord(updated);
    } catch (error) {
      lastError = error;
      console.error(
        `Failed to send review request email for request ${request.id} (attempt ${attempt + 1}/${MAX_SEND_ATTEMPTS}):`,
        error,
      );

      // Record the attempt immediately so a crash mid-retry can't silently lose the count.
      await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { sendAttempts: attempt + 1 },
      });

      if (attempt + 1 < MAX_SEND_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error(`Exhausted ${MAX_SEND_ATTEMPTS} send attempts for request ${request.id}:`, lastError);

  const updated = await prisma.reviewRequest.update({
    where: { id: request.id },
    data: { status: "failed" },
    include: {
      store: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
    },
  });

  return mapRequestRecord(updated);
};

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
        requestToken: generateRequestToken(),
        tokenExpiresAt: computeTokenExpiry(),
        status,
        ...(status === "sending" ? { sentAt: new Date() } : {}),
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    const mapped = mapRequestRecord(created);
    const request = status === "sending" ? await dispatchRequestEmail(mapped) : mapped;

    return {
      request,
      delivery: buildDeliveryPayload(request),
    };
  },

  // Order-triggered counterpart of createRequest — same status/dispatch rules (immediate
  // send when delayDays is 0, otherwise scheduled), but tags the row with the Shopify
  // order/line-item it came from and source: "order" so the admin UI can distinguish it.
  // Duplicate-prevention is enforced by the DB's unique (shopifyOrderId, productId) index —
  // callers (webhooks.fulfillments.create.tsx) are expected to catch a Prisma P2002 violation
  // as an idempotent no-op, since Shopify's webhook delivery is at-least-once, not exactly-once.
  async createFromOrder(data: {
    storeId: string;
    productId: string;
    shopifyOrderId: string;
    shopifyLineItemId: string;
    orderNumber: string;
    email: string;
    name: string;
    delayDays: number;
  }) {
    const normalizedDelay = Math.max(data.delayDays, 0);
    const status: ReviewRequestStatus = normalizedDelay === 0 ? "sending" : "scheduled";

    const created = await prisma.reviewRequest.create({
      data: {
        storeId: data.storeId,
        productId: data.productId,
        shopifyOrderId: data.shopifyOrderId,
        shopifyLineItemId: data.shopifyLineItemId,
        source: "order",
        email: data.email.trim(),
        name: data.name.trim(),
        orderNumber: data.orderNumber.trim(),
        delayDays: normalizedDelay,
        scheduledFor: buildScheduledFor(normalizedDelay),
        requestToken: generateRequestToken(),
        tokenExpiresAt: computeTokenExpiry(),
        status,
        ...(status === "sending" ? { sentAt: new Date() } : {}),
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    const mapped = mapRequestRecord(created);
    const request = status === "sending" ? await dispatchRequestEmail(mapped) : mapped;

    return {
      request,
      delivery: buildDeliveryPayload(request),
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
    const nextStatus = nextDelay === 0 ? "sending" : "scheduled";

    const updated = await prisma.reviewRequest.update({
      where: { id },
      data: {
        status: nextStatus,
        delayDays: nextDelay,
        scheduledFor: buildScheduledFor(nextDelay),
        sentAt: nextDelay === 0 ? new Date() : existing.sentAt,
        requestToken: generateRequestToken(),
        tokenExpiresAt: computeTokenExpiry(),
        tokenUsedAt: null,
      },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }).then(mapRequestRecord);

    return nextStatus === "sending" ? dispatchRequestEmail(updated) : updated;
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

  // The three functions below back the public review link (app/routes/r.$token.tsx). They
  // read/write tokenExpiresAt and tokenUsedAt directly rather than through ReviewRequestRecord
  // — those columns are a security concern specific to the resolver, not something the admin
  // list/detail views need on every row.
  async validateRequestToken(token: string): Promise<
    | { ok: true; request: ReviewRequestRecord }
    | { ok: false; reason: "not_found" | "expired" | "used" }
  > {
    const existing = await prisma.reviewRequest.findUnique({
      where: { requestToken: token },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    });

    if (!existing) {
      return { ok: false, reason: "not_found" };
    }

    if (existing.tokenUsedAt) {
      return { ok: false, reason: "used" };
    }

    if (existing.tokenExpiresAt && existing.tokenExpiresAt < new Date()) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, request: mapRequestRecord(existing) };
  },

  // Idempotent and only moves "sent" -> "clicked", so re-viewing an already-completed or
  // already-expired link never regresses its status. Named "clicked" (not "opened") because
  // this fires when the customer actually follows the emailed link — the true email-open
  // event (pixel tracking) is a distinct, not-yet-built signal; see ReviewRequestStatus.
  async markRequestClicked(token: string) {
    const existing = await prisma.reviewRequest.findUnique({ where: { requestToken: token } });

    if (!existing || existing.status !== "sent") {
      return;
    }

    await prisma.reviewRequest.update({
      where: { id: existing.id },
      data: { status: "clicked", openedAt: existing.openedAt ?? new Date() },
    });
  },

  async consumeRequestToken(id: string) {
    return prisma.reviewRequest.update({
      where: { id },
      data: { tokenUsedAt: new Date(), reviewedAt: new Date(), status: "completed" },
      include: {
        store: { select: { id: true, name: true } },
        product: { select: { id: true, name: true } },
      },
    }).then(mapRequestRecord);
  },
};