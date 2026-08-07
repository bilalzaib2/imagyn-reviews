import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../../db.server";
import { getSlug, setDevelopmentStoreFlag, updateBillingState } from "../store.server";
import { getAllPlans as getAllPlansFromPlans, type PlanId } from "./plans";

export interface BillingSnapshot {
  storeId: string;
  plan: PlanId;
  planStatus: string;
  isDevelopmentStore: boolean;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  hasAccess: boolean;
}

const ACCESS_GRANTED_STATUSES = new Set(["active", "trialing"]);

function toPlanId(value: string): PlanId {
  if (value === "growth" || value === "scale" || value === "owner") {
    return value;
  }
  return "starter";
}

// The single access-control decision the rest of the app relies on (app.tsx's gate reads
// this, nothing else re-derives it). Development stores always have access regardless of
// plan/status — see ensureDevelopmentStoreFlag below for how that flag gets set. Owner stores
// (see permissions.ts) always have access too: they carry no Shopify subscription, so
// planStatus will never naturally land in ACCESS_GRANTED_STATUSES for them.
export function getBillingSnapshot(store: {
  id: string;
  plan: string;
  planStatus: string;
  isDevelopmentStore: boolean | null;
  trialEndsAt: Date | null;
}): BillingSnapshot {
  const isDevelopmentStore = store.isDevelopmentStore ?? false;
  const plan = toPlanId(store.plan);

  return {
    storeId: store.id,
    plan,
    planStatus: store.planStatus,
    isDevelopmentStore,
    isTrialing: store.planStatus === "trialing",
    trialEndsAt: store.trialEndsAt,
    hasAccess: isDevelopmentStore || plan === "owner" || ACCESS_GRANTED_STATUSES.has(store.planStatus),
  };
}

// Convenience for services (aiSummary.server.ts, reviewMedia.server.ts, review.server.ts,
// review-request.server.ts, permissions.ts) that only have a storeId/productId on hand and
// need a plan lookup without the full billing snapshot the admin UI uses.
export async function getStorePlanId(storeId: string): Promise<PlanId> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { plan: true } });
  return toPlanId(store?.plan ?? "starter");
}

async function detectDevelopmentStore(admin: AdminApiContext): Promise<boolean> {
  const response = await admin.graphql(`#graphql
    query CheckShopPlan {
      shop {
        plan {
          partnerDevelopment
        }
      }
    }
  `);
  const json = (await response.json()) as {
    data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
  };

  return json.data?.shop?.plan?.partnerDevelopment ?? false;
}

// Called lazily from the app.tsx gate the first time a store is seen — after that the result
// is cached on Store.isDevelopmentStore permanently. A shop's development status doesn't
// change during the app's lifetime in practice, so this keeps every subsequent page load free
// of an extra Admin API round-trip.
export async function ensureDevelopmentStoreFlag(
  admin: AdminApiContext,
  store: { id: string; isDevelopmentStore: boolean | null },
): Promise<boolean> {
  if (store.isDevelopmentStore !== null) {
    return store.isDevelopmentStore;
  }

  const isDevelopmentStore = await detectDevelopmentStore(admin);
  await setDevelopmentStoreFlag(store.id, isDevelopmentStore);
  return isDevelopmentStore;
}

interface ShopifySubscription {
  id: string;
  name: string;
  status: "ACTIVE" | "CANCELLED" | "PENDING" | "DECLINED" | "EXPIRED" | "FROZEN" | "ACCEPTED";
  test: boolean;
  trialDays: number;
  createdAt: string;
}

// Raw GraphQL query rather than the SDK's billing.check() wrapper, deliberately: this needs to
// run from two different auth contexts (the billing page's live authenticate.admin session,
// and the app_subscriptions/update webhook's unauthenticated.admin(shop) session), and both
// just need an AdminApiContext — no need for two separate reconciliation implementations.
export async function syncBillingFromShopify(
  admin: AdminApiContext,
  store: { id: string; plan: string; planStatus: string },
): Promise<void> {
  // Owner stores (see permissions.ts) never have a Shopify subscription and must never be
  // reconciled back onto the normal ladder — without this, the very first billing-page visit
  // (or the afterAuth hook, or an app_subscriptions/update webhook) would find "no active
  // subscription" and silently downgrade them to Starter.
  if (store.plan === "owner") {
    return;
  }

  const response = await admin.graphql(`#graphql
    query CurrentSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          trialDays
          createdAt
        }
      }
    }
  `);
  const json = (await response.json()) as {
    data?: { currentAppInstallation?: { activeSubscriptions?: ShopifySubscription[] } };
  };

  const subscription = json.data?.currentAppInstallation?.activeSubscriptions?.[0];

  if (!subscription) {
    // No subscription on Shopify's side. A store that has never chosen a plan (still
    // "pending") is left alone — the plan-selection page is what moves it out of "pending".
    // A store that previously had a paid plan cancelled directly in Shopify Admin falls back
    // to the free Starter plan rather than being locked out entirely.
    if (store.planStatus !== "pending") {
      await updateBillingState(store.id, {
        plan: "starter",
        planStatus: "active",
        shopifySubscriptionId: null,
        trialEndsAt: null,
      });
    }
    return;
  }

  const planId: PlanId = subscription.name.toLowerCase() === "scale" ? "scale" : "growth";
  const trialEndsAt =
    subscription.trialDays > 0
      ? new Date(new Date(subscription.createdAt).getTime() + subscription.trialDays * 24 * 60 * 60 * 1000)
      : null;
  const isTrialing = trialEndsAt !== null && trialEndsAt.getTime() > Date.now();

  if (subscription.status === "ACTIVE") {
    await updateBillingState(store.id, {
      plan: planId,
      planStatus: isTrialing ? "trialing" : "active",
      shopifySubscriptionId: subscription.id,
      trialEndsAt,
    });
    return;
  }

  if (subscription.status === "FROZEN") {
    await updateBillingState(store.id, {
      plan: planId,
      planStatus: "frozen",
      shopifySubscriptionId: subscription.id,
      trialEndsAt,
    });
    return;
  }

  if (subscription.status === "PENDING") {
    // Merchant approved the confirmation screen but Shopify hasn't finished activating it yet
    // — leave the store as-is, a subsequent check (webhook or next page load) will resolve it.
    return;
  }

  // CANCELLED / DECLINED / EXPIRED / ACCEPTED-but-inactive — fall back to the free plan.
  await updateBillingState(store.id, {
    plan: "starter",
    planStatus: "active",
    shopifySubscriptionId: null,
    trialEndsAt: null,
  });
}

// Free plan — a local, no-Shopify-charge selection. Still an explicit choice (matches the
// plan-selection page's "must pick something" flow), not a silent default.
export async function selectStarterPlan(storeId: string) {
  return updateBillingState(storeId, {
    plan: "starter",
    planStatus: "active",
    shopifySubscriptionId: null,
    trialEndsAt: null,
  });
}

interface AppHandleResponse {
  data?: { currentAppInstallation?: { app?: { handle?: string | null } | null } | null };
}

// Shopify Managed Pricing apps can't create or cancel charges via the Billing API — Shopify
// rejects appSubscriptionCreate/appPurchaseOneTimeCreate outright ("Managed Pricing Apps
// cannot use the Billing API (to create charges)."). Every plan change instead happens on
// Shopify's own hosted page, and the app's only job is sending the merchant there. The app
// handle isn't stored anywhere in this repo (not in shopify.app.toml, not cached locally), so
// it's fetched live rather than hardcoded — this is the one Admin GraphQL field that exposes
// it (App.handle).
export async function getPricingPlansUrl(admin: AdminApiContext, shop: string): Promise<string> {
  const response = await admin.graphql(`#graphql
    query AppHandle {
      currentAppInstallation {
        app {
          handle
        }
      }
    }
  `);
  const json = (await response.json()) as AppHandleResponse;
  const appHandle = json.data?.currentAppInstallation?.app?.handle;

  if (!appHandle) {
    throw new Error("Could not resolve the app handle from Shopify — cannot build the pricing plans URL.");
  }

  return `https://admin.shopify.com/store/${getSlug(shop)}/charges/${appHandle}/pricing_plans`;
}

// Thin re-export so existing callers (app.billing.tsx) don't need a second import path —
// plans.ts owns PLAN_ORDER/getPlan now that plan metadata and gating logic (permissions.ts)
// are fully split apart.
export const getAllPlans = getAllPlansFromPlans;
