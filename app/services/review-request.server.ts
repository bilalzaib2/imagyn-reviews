import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getEmailProvider } from "./notifications/provider.server";
import { buildReviewRequestEmail } from "./notifications/templates.server";
import { emailTemplateService } from "./emailTemplate.server";
import { buildUnsubscribeUrl, emailSuppressionService } from "./emailSuppression.server";

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
export type ReviewRequestSortBy = "createdAt" | "scheduledFor" | "status" | "name";
export type ReviewRequestSortDir = "asc" | "desc";

export interface ReviewRequestListOptions {
  search?: string;
  status?: ReviewRequestStatus;
  dateFilter?: ReviewRequestDateFilter;
  page?: number;
  pageSize?: number;
  // Defaults to createdAt/desc (unchanged from before this option existed) — the admin
  // Requests page's new Sort control is the only caller that sets these explicitly.
  sortBy?: ReviewRequestSortBy;
  sortDir?: ReviewRequestSortDir;
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
  // Automatic Reminder Emails — see dispatchReminderEmail below. Independent of status/sentAt,
  // which track only the original Day-0 request.
  reminder1SentAt: Date | null;
  reminderFinalSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  store: { id: string; name: string; domain: string | null };
  product: { id: string; name: string | null; featuredImage: string | null } | null;
}

export interface ReviewRequestListResult {
  requests: ReviewRequestRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
}

// Shared across every query in this file that needs the parent store/product — store.domain
// (the shop's myshopify.com domain) is needed by r.$token.tsx to get an unauthenticated Admin
// API session for photo uploads, and product.featuredImage is shown on the public review page.
const REQUEST_INCLUDE = {
  store: { select: { id: true, name: true, domain: true } },
  product: { select: { id: true, name: true, featuredImage: true } },
} as const;

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
  reminder1SentAt: Date | null;
  reminderFinalSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  store: { id: string; name: string; domain: string | null };
  product: { id: string; name: string | null; featuredImage: string | null } | null;
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
  reminder1SentAt: request.reminder1SentAt,
  reminderFinalSentAt: request.reminderFinalSentAt,
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

  // Suppression blocks every automated send this function makes — the Day-0 request itself,
  // regardless of whether this call came from immediate creation, the scheduler sweep, or a
  // merchant's manual Send Now/Resend action (resendRequest below calls this same function).
  // Returns the request unchanged, same as the missing-email/token guard above — a suppressed,
  // still-"scheduled" request simply never resolves to sent/failed on its own; a merchant can
  // still cancel it explicitly from the admin UI.
  if (await emailSuppressionService.isSuppressed(request.store.id, request.email)) {
    return request;
  }

  // Falls back to today's hardcoded defaults (getDefaultEmailTemplateContent) when the store
  // hasn't customized anything in Email Studio — see templates.server.tsx's `template` param.
  const template = await emailTemplateService.getActiveContent(request.store.id);

  const { subject, html, text } = await buildReviewRequestEmail({
    customerName: request.name || "there",
    productName: request.product?.name || "your recent purchase",
    storeName: request.store.name,
    reviewUrl: buildReviewUrl(request.requestToken),
    unsubscribeUrl: buildUnsubscribeUrl(request.store.id, request.email),
    customMessage: request.customMessage,
    template,
  });

  let lastError: unknown;

  for (let attempt = request.sendAttempts; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      await getEmailProvider().sendEmail({
        to: request.email,
        subject,
        html,
        text,
        // Customer-facing send — reads as coming from the store, not Imagyn (see
        // resend.server.ts's fromName handling).
        fromName: request.store.name,
        // Lets webhooks.resend.tsx correlate a delivery event back to this exact row via the
        // existing unique requestToken column — no new schema column needed for that lookup.
        tags: { request_token: request.requestToken },
      });

      const updated = await prisma.reviewRequest.update({
        where: { id: request.id },
        data: { status: "sent", sendAttempts: attempt + 1 },
        include: REQUEST_INCLUDE,
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
    include: REQUEST_INCLUDE,
  });

  return mapRequestRecord(updated);
};

export type ReminderType = "reminder_1" | "reminder_final";

const REMINDER_FIELD: Record<ReminderType, "reminder1SentAt" | "reminderFinalSentAt"> = {
  reminder_1: "reminder1SentAt",
  reminder_final: "reminderFinalSentAt",
};

// Sends a reminder email and records it on its own field (reminder1SentAt/reminderFinalSentAt),
// deliberately never touching `status`/`sentAt`/`sendAttempts` — those track only the original
// Day-0 request's lifecycle, which a reminder must never regress or reinterpret (e.g. a request
// already at "opened" must stay "opened", not bounce back to "sent"). Reuses the same
// request_token tag dispatchRequestEmail attaches, so webhooks.resend.tsx still correlates a
// reminder's own delivered/opened events back to this row — safe under the existing
// forward-only rank guard (LIFECYCLE_RANK), though it means reminder-specific delivery/open
// visibility isn't tracked separately, an accepted limitation for this pass.
//
// Idempotency: the caller (reviewRequestScheduler.server.ts's runDueReminderSweep) only ever
// selects rows where the relevant field is still null, and this function is the only writer of
// that field — once set, the row can never be selected again, so the same reminder can never be
// sent twice. On a send failure, the field is deliberately left unset (unlike
// dispatchRequestEmail's bounded MAX_SEND_ATTEMPTS retry) — the next sweep tick (5 minutes
// later) naturally retries, since nothing else about the row's eligibility changed. A reminder
// has no customer-facing urgency the way the Day-0 send does, so this simpler, unbounded-retry-
// by-next-tick approach is deliberate, not an oversight.
export const dispatchReminderEmail = async (request: ReviewRequestRecord, reminderType: ReminderType): Promise<void> => {
  if (!request.email || !request.requestToken) {
    return;
  }

  // Same suppression guard as dispatchRequestEmail — a suppressed recipient never receives a
  // reminder, whether this call came from the scheduler sweep or a manual admin action.
  if (await emailSuppressionService.isSuppressed(request.store.id, request.email)) {
    return;
  }

  const template = await emailTemplateService.getActiveContent(request.store.id, reminderType);

  const { subject, html, text } = await buildReviewRequestEmail({
    customerName: request.name || "there",
    productName: request.product?.name || "your recent purchase",
    storeName: request.store.name,
    reviewUrl: buildReviewUrl(request.requestToken),
    unsubscribeUrl: buildUnsubscribeUrl(request.store.id, request.email),
    // The original request's per-request custom message (if any) was already delivered on
    // Day 0 — a reminder is its own distinct email and shouldn't repeat it.
    customMessage: null,
    template,
  });

  try {
    await getEmailProvider().sendEmail({
      to: request.email,
      subject,
      html,
      text,
      // Same as dispatchRequestEmail — a reminder is still the store talking to its own
      // customer, not Imagyn.
      fromName: request.store.name,
      tags: { request_token: request.requestToken, email_type: reminderType },
    });
  } catch (error) {
    console.error(`Failed to send ${reminderType} email for request ${request.id}:`, error);
    return;
  }

  await prisma.reviewRequest.update({
    where: { id: request.id },
    data: { [REMINDER_FIELD[reminderType]]: new Date() },
  });
};

// Monotonic rank for the delivery-tracking portion of the lifecycle — used only by
// webhooks.resend.tsx's forward-only status updates below, so a delivery event that arrives
// out of order (Resend's own webhook delivery, like Shopify's, is at-least-once and
// unordered) can never regress what the merchant sees. "completed"/"cancelled"/"failed" are
// deliberately excluded: those are decided by the admin action or the customer's own
// submission, never by a delivery-tracking signal — see isTerminalForWebhooks.
const LIFECYCLE_RANK: Partial<Record<ReviewRequestStatus, number>> = {
  sending: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
};

const isTerminalForWebhooks = (status: ReviewRequestStatus): boolean =>
  status === "completed" || status === "cancelled" || status === "failed";

// Shared by markRequestDelivered/markRequestOpened — applies a forward-only status update,
// silently doing nothing if the request is already at or past that point, or already
// terminal. Returns whether it actually changed anything, purely so the webhook route can log
// a meaningful outcome without a second query.
async function applyForwardOnlyStatus(token: string, nextStatus: "delivered" | "opened"): Promise<boolean> {
  const existing = await prisma.reviewRequest.findUnique({ where: { requestToken: token } });

  if (!existing) {
    return false;
  }

  const currentStatus = existing.status as ReviewRequestStatus;

  if (isTerminalForWebhooks(currentStatus)) {
    return false;
  }

  const currentRank = LIFECYCLE_RANK[currentStatus] ?? 0;
  const nextRank = LIFECYCLE_RANK[nextStatus] as number;

  if (nextRank <= currentRank) {
    return false;
  }

  await prisma.reviewRequest.update({
    where: { id: existing.id },
    data: {
      status: nextStatus,
      // Reuses openedAt exactly the way markRequestClicked already does — this schema has no
      // separate deliveredAt/clickedAt column, so openedAt is "first time we know the customer
      // (or their inbox) actually engaged," whichever signal got there first.
      ...(nextStatus === "opened" ? { openedAt: existing.openedAt ?? new Date() } : {}),
    },
  });

  return true;
}

export const reviewRequestService = {
  // storeId is required and folded into the same `where` as every other filter — the admin
  // Requests page (app.requests.tsx) is the only merchant-facing caller of this; the scheduler
  // sweep (reviewRequestScheduler.server.ts) and internal dispatch (getRequest below) are
  // deliberately separate, unscoped-by-design code paths that process every store's due
  // requests in one pass, not per-request admin reads.
  async listRequests(storeId: string, options: ReviewRequestListOptions = {}): Promise<ReviewRequestListResult> {
    const pageSize = options.pageSize ?? 10;
    const page = Math.max(options.page ?? 1, 1);

    const where = {
      storeId,
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

    const sortDir = options.sortDir ?? "desc";
    const orderBy =
      options.sortBy && options.sortBy !== "createdAt"
        ? [{ [options.sortBy]: sortDir }, { id: sortDir }]
        : [{ createdAt: sortDir }, { id: sortDir }];

    const [totalCount, requests] = await Promise.all([
      prisma.reviewRequest.count({ where }),
      prisma.reviewRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy,
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

  // Internal-only (reviewRequestDispatch.server.ts's enqueueReviewRequestDispatch, called from
  // the scheduler sweep) — deliberately NOT storeId-scoped, since the sweep resolves a
  // requestId it already found via its own cross-store query, not from any merchant input.
  // Never call this from an admin route; use listRequests/getOwnedRequest instead.
  async getRequest(id: string) {
    const request = await prisma.reviewRequest.findUnique({
      where: { id },
      include: REQUEST_INCLUDE,
    });

    return request ? mapRequestRecord(request) : null;
  },

  // Dashboard "Review Request performance" — how many requests actually went out, and how
  // many of those converted into a submitted review. "Sent" counts every status a request
  // reaches only after a successful send (sent/delivered/opened/clicked/completed);
  // pending/scheduled haven't gone out yet, and failed never went out at all.
  async getRequestStats(storeId: string): Promise<{ totalCount: number; sent: number; completed: number; completionRate: number }> {
    const groups = await prisma.reviewRequest.groupBy({
      by: ["status"],
      where: { storeId },
      _count: { status: true },
    });

    const countByStatus = new Map(groups.map((group) => [group.status, group._count.status]));
    const sentStatuses: ReviewRequestStatus[] = ["sent", "delivered", "opened", "clicked", "completed"];
    const sent = sentStatuses.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0);
    const completed = countByStatus.get("completed") ?? 0;

    return {
      totalCount: groups.reduce((sum, group) => sum + group._count.status, 0),
      sent,
      completed,
      completionRate: sent > 0 ? completed / sent : 0,
    };
  },

  // Feeds the admin Requests page's product picker — scoped so a merchant can never even see,
  // let alone select, another store's product.
  async listProducts(storeId: string) {
    return prisma.product.findMany({
      where: { storeId },
      select: { id: true, name: true, storeId: true },
      orderBy: { name: "asc" },
    });
  },

  // Feeds the admin Requests page's customer picker — scoped so a merchant can never see
  // another store's customer names/emails (this was a live PII leak before storeId was added
  // here; see the master audit that found it).
  async listCustomers(storeId: string) {
    return prisma.review.findMany({
      where: {
        storeId,
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

  // Backs the create-request modal's inline duplicate warning (app.requests.tsx) — read-only,
  // never blocks by itself. The caller decides whether to surface a warning and let the
  // merchant confirm anyway; this just answers "what already exists for this exact
  // (customer, product) pair," scoped to storeId the same way createRequest's own product
  // lookup is, so it can never see another store's data.
  async getExistingRequestContext(
    storeId: string,
    params: { email: string; productId: string },
  ): Promise<{ hasPendingRequest: boolean; hasSentRequest: boolean; hasExistingReview: boolean }> {
    const email = params.email.trim();

    const [pending, sent, review] = await Promise.all([
      prisma.reviewRequest.findFirst({
        where: {
          storeId,
          productId: params.productId,
          email,
          status: { in: ["pending", "scheduled", "sending"] },
        },
        select: { id: true },
      }),
      prisma.reviewRequest.findFirst({
        where: {
          storeId,
          productId: params.productId,
          email,
          status: { in: ["sent", "delivered", "opened", "clicked"] },
        },
        select: { id: true },
      }),
      prisma.review.findFirst({
        where: { storeId, productId: params.productId, reviewerEmail: email, deletedAt: null },
        select: { id: true },
      }),
    ]);

    return {
      hasPendingRequest: Boolean(pending),
      hasSentRequest: Boolean(sent),
      hasExistingReview: Boolean(review),
    };
  },

  // Bulk counterpart of getExistingRequestContext above — same three checks, same duplicate-
  // prevention meaning, but for an entire page of real Shopify orders at once (the "Shopify
  // Orders" Send Request tab) instead of one (email, productId) pair. Three queries total
  // regardless of how many pairs are requested, not three-per-pair, since this runs once per
  // page render rather than once per confirm-click.
  async getExistingRequestContextBulk(
    storeId: string,
    pairs: Array<{ email: string; productId: string }>,
  ): Promise<Map<string, { hasPendingRequest: boolean; hasSentRequest: boolean; hasExistingReview: boolean }>> {
    const normalized = pairs
      .map((pair) => ({ email: pair.email.trim(), productId: pair.productId }))
      .filter((pair) => pair.email && pair.productId);

    const key = (email: string, productId: string) => `${email.toLowerCase()}||${productId}`;
    const result = new Map<string, { hasPendingRequest: boolean; hasSentRequest: boolean; hasExistingReview: boolean }>();

    if (normalized.length === 0) {
      return result;
    }

    const productIds = Array.from(new Set(normalized.map((pair) => pair.productId)));
    const emails = Array.from(new Set(normalized.map((pair) => pair.email)));
    const pairKeys = new Set(normalized.map((pair) => key(pair.email, pair.productId)));

    const [pending, sent, reviews] = await Promise.all([
      prisma.reviewRequest.findMany({
        where: { storeId, productId: { in: productIds }, email: { in: emails }, status: { in: ["pending", "scheduled", "sending"] } },
        select: { email: true, productId: true },
      }),
      prisma.reviewRequest.findMany({
        where: { storeId, productId: { in: productIds }, email: { in: emails }, status: { in: ["sent", "delivered", "opened", "clicked"] } },
        select: { email: true, productId: true },
      }),
      prisma.review.findMany({
        where: { storeId, productId: { in: productIds }, reviewerEmail: { in: emails }, deletedAt: null },
        select: { reviewerEmail: true, productId: true },
      }),
    ]);

    for (const pair of normalized) {
      result.set(key(pair.email, pair.productId), { hasPendingRequest: false, hasSentRequest: false, hasExistingReview: false });
    }

    for (const row of pending) {
      const rowKey = key(row.email ?? "", row.productId ?? "");
      if (pairKeys.has(rowKey)) result.get(rowKey)!.hasPendingRequest = true;
    }
    for (const row of sent) {
      const rowKey = key(row.email ?? "", row.productId ?? "");
      if (pairKeys.has(rowKey)) result.get(rowKey)!.hasSentRequest = true;
    }
    for (const row of reviews) {
      const rowKey = key(row.reviewerEmail ?? "", row.productId ?? "");
      if (pairKeys.has(rowKey)) result.get(rowKey)!.hasExistingReview = true;
    }

    return result;
  },

  // storeId is the caller's already-authenticated store, never derived from the client-supplied
  // productId — same "resolve the product through the trusted storeId, not the other way
  // around" pattern review.server.ts's createReview uses. Without this, a merchant could still
  // POST an arbitrary productId directly (bypassing the now-scoped listProducts picker) and
  // create a request against another store's product.
  async createRequest(storeId: string, data: {
    productId: string;
    email: string;
    name: string;
    orderNumber?: string | null;
    customMessage?: string | null;
    delayDays: number;
    status?: ReviewRequestStatus;
  }) {
    const product = await prisma.product.findFirst({
      where: { id: data.productId, storeId },
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
      include: REQUEST_INCLUDE,
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
      include: REQUEST_INCLUDE,
    });

    const mapped = mapRequestRecord(created);
    const request = status === "sending" ? await dispatchRequestEmail(mapped) : mapped;

    return {
      request,
      delivery: buildDeliveryPayload(request),
    };
  },

  // Bulk counterpart of createFromOrder above, for the "Send Request → Shopify Orders" manual
  // flow (app.requests.tsx) — a merchant selecting real Shopify orders/line-items to request
  // reviews for right now, rather than waiting for the automatic webhook. Deliberately reuses
  // createFromOrder itself (same idempotent unique-constraint-on-(shopifyOrderId, productId)
  // path, same "source: order" tagging) rather than a second creation code path, so a request
  // created this way and one the webhook would later create for the exact same order+product
  // can never both exist — whichever happens first wins, the other is a harmless no-op. One bad
  // row (e.g. a product that was un-synced between page load and submit) never aborts the rest
  // of the batch.
  async createManyFromOrders(
    storeId: string,
    selections: Array<{
      productId: string;
      shopifyOrderId: string;
      shopifyLineItemId: string;
      orderNumber: string;
      email: string;
      name: string;
      delayDays: number;
    }>,
  ): Promise<{ created: number; skippedDuplicates: number; failed: number }> {
    let created = 0;
    let skippedDuplicates = 0;
    let failed = 0;

    for (const selection of selections) {
      try {
        // Safe forward reference: this function body only runs when called, by which point
        // the reviewRequestService const below has already been fully assigned.
        await reviewRequestService.createFromOrder({ ...selection, storeId });
        created += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          skippedDuplicates += 1;
          continue;
        }
        console.error(`[review-request] Failed to create request from order ${selection.shopifyOrderId}:`, error);
        failed += 1;
      }
    }

    return { created, skippedDuplicates, failed };
  },

  // storeId is checked in the same lookup that resolves the target row, not as a follow-up
  // comparison — a cross-tenant id produces the exact same "not found" a bogus id would,
  // matching requireReview's convention in review.server.ts.
  async updateRequest(storeId: string, id: string, data: {
    productId?: string | null;
    email?: string | null;
    name?: string | null;
    orderNumber?: string | null;
    customMessage?: string | null;
    delayDays?: number | null;
    status?: ReviewRequestStatus;
  }) {
    const existing = await prisma.reviewRequest.findFirst({ where: { id, storeId } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    // Reassigning to a different product must stay inside the same store — same reasoning as
    // createRequest's product lookup above.
    if (data.productId) {
      const product = await prisma.product.findFirst({ where: { id: data.productId, storeId } });
      if (!product) {
        throw new Error("Product not found.");
      }
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
      include: REQUEST_INCLUDE,
    }).then(mapRequestRecord);
  },

  async rescheduleRequest(storeId: string, id: string, delayDays: number) {
    const existing = await prisma.reviewRequest.findFirst({ where: { id, storeId } });

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
      include: REQUEST_INCLUDE,
    }).then(mapRequestRecord);
  },

  // The one operation here that sends a real email — ownership must be verified before any of
  // the token/dispatch side effects below, not just before the return value is built.
  // `sendNow`: bypasses the request's own delayDays and dispatches immediately regardless —
  // backs the admin bulk "Send Now" action (app.requests.tsx), which needs to force-dispatch a
  // still-scheduled request rather than just resetting its future schedule the way a plain
  // resend does. Same guard, same dispatch path (dispatchRequestEmail) either way — this isn't
  // a second send mechanism, just a different value for the same nextDelay computation below.
  async resendRequest(storeId: string, id: string, options: { sendNow?: boolean } = {}) {
    const existing = await prisma.reviewRequest.findFirst({ where: { id, storeId } });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    // A completed request already has a submitted review tied to it — issuing a fresh token
    // would let the same customer submit a second review for the same product through this
    // request, and createReview has no duplicate-per-customer-per-product guard of its own.
    // Resending from "cancelled" is left allowed: reviving a cancelled request is a legitimate
    // merchant action, not a duplicate-review risk.
    if (existing.status === "completed") {
      throw new Error("This request was already completed — the customer has already submitted a review.");
    }

    const nextDelay = options.sendNow ? 0 : (existing.delayDays ?? 0);
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
      include: REQUEST_INCLUDE,
    }).then(mapRequestRecord);

    return nextStatus === "sending" ? dispatchRequestEmail(updated) : updated;
  },

  async cancelRequest(storeId: string, id: string) {
    const existing = await prisma.reviewRequest.findFirst({ where: { id, storeId }, include: REQUEST_INCLUDE });

    if (!existing) {
      throw new Error("Review request not found.");
    }

    // Idempotent no-op, not an error — a merchant clicking "Cancel" twice (e.g. a slow
    // double-click) shouldn't see a failure toast for an action that already succeeded.
    if (existing.status === "cancelled") {
      return mapRequestRecord(existing);
    }

    // A completed request already has its review — there's nothing left to cancel, and
    // silently "succeeding" here would misleadingly suggest the review submission itself
    // was undone.
    if (existing.status === "completed") {
      throw new Error("This request was already completed and can't be cancelled.");
    }

    return prisma.reviewRequest.update({
      where: { id },
      data: { status: "cancelled" },
      include: REQUEST_INCLUDE,
    }).then(mapRequestRecord);
  },

  async deleteRequest(storeId: string, id: string) {
    const existing = await prisma.reviewRequest.findFirst({ where: { id, storeId } });

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
      include: REQUEST_INCLUDE,
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

  // The three functions below back webhooks.resend.tsx. Each is forward-only and idempotent
  // by construction (see applyForwardOnlyStatus/LIFECYCLE_RANK above) — receiving the same
  // Resend event twice, or events out of their usual order, never regresses or double-applies
  // anything. None of them ever create a ReviewRequest or a Review; they only update a status
  // string (and, for "opened", a timestamp) on a row that already exists.
  async markRequestDelivered(token: string): Promise<boolean> {
    return applyForwardOnlyStatus(token, "delivered");
  },

  async markRequestOpened(token: string): Promise<boolean> {
    return applyForwardOnlyStatus(token, "opened");
  },

  // Bounce/complaint/send-failure signals from Resend. Moves the request to "failed" only if
  // the customer hasn't already engaged (clicked through) and the request isn't already
  // terminal — a bounce notification that arrives after a real click or completion is stale
  // noise (e.g. a delayed soft-bounce report), not a more-authoritative signal than what
  // actually happened. Returns whether it actually changed anything.
  async markRequestDeliveryFailed(token: string): Promise<boolean> {
    const existing = await prisma.reviewRequest.findUnique({ where: { requestToken: token } });

    if (!existing) {
      return false;
    }

    const currentStatus = existing.status as ReviewRequestStatus;

    if (isTerminalForWebhooks(currentStatus) || currentStatus === "clicked") {
      return false;
    }

    await prisma.reviewRequest.update({
      where: { id: existing.id },
      data: { status: "failed" },
    });

    return true;
  },

  async consumeRequestToken(id: string) {
    return prisma.reviewRequest.update({
      where: { id },
      data: { tokenUsedAt: new Date(), reviewedAt: new Date(), status: "completed" },
      include: REQUEST_INCLUDE,
    }).then(mapRequestRecord);
  },
};