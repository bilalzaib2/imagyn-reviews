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
