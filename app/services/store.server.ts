import prisma from "../db.server";

function getShopName(shop: string) {
  return shop
    .replace(".myshopify.com", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getSlug(shop: string) {
  return shop.replace(".myshopify.com", "");
}

export async function getOrCreateStore(shop: string) {
  const slug = getSlug(shop);

  return prisma.store.upsert({
    where: {
      slug,
    },
    update: {
      domain: shop,
    },
    create: {
      name: getShopName(shop),
      slug,
      domain: shop,
    },
  });
}

export async function getStoreById(id: string) {
  return prisma.store.findUnique({
    where: {
      id,
    },
  });
}

export async function getStoreBySlug(slug: string) {
  return prisma.store.findUnique({
    where: {
      slug,
    },
  });
}

export async function updateStore(
  id: string,
  data: {
    name?: string;
    domain?: string | null;
  },
) {
  return prisma.store.update({
    where: {
      id,
    },
    data,
  });
}

// Order-lifecycle automation settings (app.settings.tsx) — read by
// webhooks.fulfillments.create.tsx to decide whether/how long to delay an auto-created
// Review Request. autoRequestTrigger stays a plain string (not an enum) so a future trigger
// type (e.g. "delivery") is a config addition here, not a schema change.
export async function updateAutoRequestSettings(
  id: string,
  data: {
    autoRequestEnabled: boolean;
    autoRequestDelayDays: number;
  },
) {
  return prisma.store.update({
    where: {
      id,
    },
    data: {
      autoRequestEnabled: data.autoRequestEnabled,
      autoRequestDelayDays: Math.max(data.autoRequestDelayDays, 0),
    },
  });
}

// Automatic Reminder Emails (app.settings.tsx). remindersEnabledAt is bumped forward only on
// an off->on transition — never on a resave while already on — so re-enabling after a period
// of being off starts the eligibility cutoff fresh rather than resurrecting whatever backlog
// accumulated while off (see reviewRequestScheduler.server.ts's runDueReminderSweep and
// Store.remindersEnabledAt's own schema comment for the safety rule this implements).
export async function updateReminderSettings(id: string, data: { reminderEmailsEnabled: boolean }) {
  const current = await prisma.store.findUnique({
    where: { id },
    select: { reminderEmailsEnabled: true },
  });

  const isNewlyEnabled = data.reminderEmailsEnabled && !current?.reminderEmailsEnabled;

  return prisma.store.update({
    where: {
      id,
    },
    data: {
      reminderEmailsEnabled: data.reminderEmailsEnabled,
      ...(isNewlyEnabled ? { remindersEnabledAt: new Date() } : {}),
    },
  });
}

// Shopify Billing state (app/services/billing/billing.server.ts) — this is the only place
// that writes these columns, so the cache's write path stays in one function regardless of
// which billing flow (plan selection, webhook, live reconciliation) triggered the update.
export async function updateBillingState(
  id: string,
  data: {
    plan: string;
    planStatus: string;
    shopifySubscriptionId?: string | null;
    trialEndsAt?: Date | null;
  },
) {
  return prisma.store.update({
    where: {
      id,
    },
    data,
  });
}

// Moderation Rules (see app/services/moderationRules.server.ts). bannedWords arrives here
// already newline-joined (Settings' textarea value) and is stored as-is — parsing into an
// array only happens on read, in moderationRules.server.ts's getModerationSettings.
export async function updateModerationSettings(
  id: string,
  data: {
    moderationRulesEnabled: boolean;
    moderationMinRating: number;
    moderationRequireVerified: boolean;
    moderationHoldLinks: boolean;
    moderationHoldProfanity: boolean;
    moderationBannedWords: string;
    moderationNotifyOnHold: boolean;
    moderationNotifyEmail: string | null;
  },
) {
  return prisma.store.update({
    where: {
      id,
    },
    data: {
      moderationRulesEnabled: data.moderationRulesEnabled,
      moderationMinRating: Math.min(Math.max(Math.round(data.moderationMinRating), 1), 5),
      moderationRequireVerified: data.moderationRequireVerified,
      moderationHoldLinks: data.moderationHoldLinks,
      moderationHoldProfanity: data.moderationHoldProfanity,
      moderationBannedWords: data.moderationBannedWords,
      moderationNotifyOnHold: data.moderationNotifyOnHold,
      moderationNotifyEmail: data.moderationNotifyOnHold ? data.moderationNotifyEmail?.trim() || null : null,
    },
  });
}

export type ProductSyncStatus = "idle" | "running" | "completed" | "failed";

export interface ProductSyncState {
  status: ProductSyncStatus;
  total: number | null;
  synced: number;
  failed: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

function toProductSyncStatus(value: string): ProductSyncStatus {
  return value === "running" || value === "completed" || value === "failed" ? value : "idle";
}

// Full-catalog product sync progress (see product.server.ts's syncAllProducts and
// productSync.server.ts's runProductSync) — read by the products page and its polling status
// route. Gating the Judge.me importer on this (only allow it once status is "completed") is
// planned but not yet wired up — out of scope for this pass, deliberately deferred.
export async function getProductSyncState(id: string): Promise<ProductSyncState> {
  const store = await prisma.store.findUnique({
    where: { id },
    select: {
      productSyncStatus: true,
      productSyncTotal: true,
      productSyncSynced: true,
      productSyncFailed: true,
      productSyncStartedAt: true,
      productSyncFinishedAt: true,
      productSyncError: true,
    },
  });

  return {
    status: toProductSyncStatus(store?.productSyncStatus ?? "idle"),
    total: store?.productSyncTotal ?? null,
    synced: store?.productSyncSynced ?? 0,
    failed: store?.productSyncFailed ?? 0,
    startedAt: store?.productSyncStartedAt ?? null,
    finishedAt: store?.productSyncFinishedAt ?? null,
    error: store?.productSyncError ?? null,
  };
}

// Resets counters to zero rather than leaving the previous run's numbers on screen while the
// new one ramps up — a merchant re-running sync should see 0/? immediately, not the old run's
// final count sitting there looking like live progress.
export async function startProductSync(id: string) {
  return prisma.store.update({
    where: { id },
    data: {
      productSyncStatus: "running",
      productSyncTotal: null,
      productSyncSynced: 0,
      productSyncFailed: 0,
      productSyncStartedAt: new Date(),
      productSyncFinishedAt: null,
      productSyncError: null,
    },
  });
}

// Called after every page of the Shopify pagination loop (see product.server.ts's
// syncAllProducts) — each call is a small, independent write rather than one held-open
// transaction for the whole sync, since a sync can run for minutes across tens of thousands of
// products and the polling status route needs to see progress as it happens, not just at the
// end.
export async function updateProductSyncProgress(
  id: string,
  data: { synced: number; failed: number; total: number | null },
) {
  return prisma.store.update({
    where: { id },
    data: {
      productSyncSynced: data.synced,
      productSyncFailed: data.failed,
      productSyncTotal: data.total,
    },
  });
}

export async function finishProductSync(id: string, data: { status: "completed" | "failed"; error: string | null }) {
  return prisma.store.update({
    where: { id },
    data: {
      productSyncStatus: data.status,
      productSyncFinishedAt: new Date(),
      productSyncError: data.error,
    },
  });
}

export async function setDevelopmentStoreFlag(id: string, isDevelopmentStore: boolean) {
  return prisma.store.update({
    where: {
      id,
    },
    data: {
      isDevelopmentStore,
    },
  });
}

export async function deleteStore(id: string) {
  return prisma.store.delete({
    where: {
      id,
    },
  });
}
