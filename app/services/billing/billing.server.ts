import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { BillingReplacementBehavior } from "@shopify/shopify-app-react-router/server";
import prisma from "../../db.server";
import { authenticate } from "../../shopify.server";
import { setDevelopmentStoreFlag, updateBillingState } from "../store.server";
import { getPlan, PLAN_ORDER, type Plan, type PlanId, type PlanLimits } from "./plans";

// Matches whatever authenticate.admin(request) actually returns, so this stays correct if the
// SDK's billing types ever change shape — no hand-rolled generic billing config type to keep
// in sync separately.
type Billing = Awaited<ReturnType<typeof authenticate.admin>>["billing"];

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
  return value === "growth" || value === "pro" ? value : "starter";
}

// The single access-control decision the rest of the app relies on (app.tsx's gate reads
// this, nothing else re-derives it). Development stores always have access regardless of
// plan/status — see ensureDevelopmentStoreFlag below for how that flag gets set.
export function getBillingSnapshot(store: {
  id: string;
  plan: string;
  planStatus: string;
  isDevelopmentStore: boolean | null;
  trialEndsAt: Date | null;
}): BillingSnapshot {
  const isDevelopmentStore = store.isDevelopmentStore ?? false;

  return {
    storeId: store.id,
    plan: toPlanId(store.plan),
    planStatus: store.planStatus,
    isDevelopmentStore,
    isTrialing: store.planStatus === "trialing",
    trialEndsAt: store.trialEndsAt,
    hasAccess: isDevelopmentStore || ACCESS_GRANTED_STATUSES.has(store.planStatus),
  };
}

export function getPlanLimits(plan: PlanId): PlanLimits {
  return getPlan(plan).limits;
}

// Convenience for services (aiSummary.server.ts, reviewMedia.server.ts, review.server.ts,
// review-request.server.ts) that only have a storeId/productId on hand and need a plan-gating
// decision, without needing the full billing snapshot the admin UI uses.
export async function getStorePlanId(storeId: string): Promise<PlanId> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { plan: true } });
  return toPlanId(store?.plan ?? "starter");
}

// Throws a clear, upgrade-prompting error — the standard shape every feature gate
// (review.server.ts, aiSummary.server.ts, reviewMedia.server.ts) throws when a store's plan
// doesn't include a given capability, so callers only need one catch pattern.
export class PlanLimitError extends Error {
  constructor(
    message: string,
    public readonly requiredPlan: PlanId,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function assertPlanFeature(plan: PlanId, feature: keyof PlanLimits, message: string, requiredPlan: PlanId) {
  if (!getPlanLimits(plan)[feature]) {
    throw new PlanLimitError(message, requiredPlan);
  }
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
  store: { id: string; planStatus: string },
): Promise<void> {
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

  const planId: PlanId = subscription.name.toLowerCase() === "pro" ? "pro" : "growth";
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

// Shopify's Billing API requires returnUrl as a fully-qualified `URL!` GraphQL scalar — a
// relative path fails with 'Variable "$returnUrl" of type URL! was provided invalid value.'
// Same env-var precedent as review-request.server.ts's buildReviewUrl.
//
// Just as important: Shopify's redirect back from the charge confirmation screen only ever
// APPENDS `charge_id` to whatever returnUrl you gave it — it does not restore `shop`/`host`.
// Without those two params already present, authenticate.admin() has no way to recognize the
// landing request as belonging to an embedded session, and falls back to rendering a bare,
// blank App Bridge bootstrap page (HTTP 200, no visible content — this is
// @shopify/shopify-app-react-router's own documented fallback for a document request missing
// shop/host, not a bug in that fallback itself). Embedding shop+host in returnUrl up front is
// what makes the landing request self-sufficient.
export function buildBillingReturnUrl(shop: string, host: string | null): string {
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000";
  const url = new URL(`${appUrl.replace(/\/$/, "")}/app/billing`);
  url.searchParams.set("shop", shop);
  if (host) {
    url.searchParams.set("host", host);
  }
  return url.toString();
}

// Always throws (redirects to Shopify's charge confirmation screen) — matches the SDK's own
// billing.request() contract. isTest must be passed explicitly: the SDK defaults it to `true`,
// which would silently create a non-billing test charge for a real merchant if left unset.
export async function requestPaidPlan(
  billing: Billing,
  planId: "growth" | "pro",
  isDevelopmentStore: boolean,
  returnUrl: string,
): Promise<never> {
  return billing.request({
    plan: planId === "growth" ? "Growth" : "Pro",
    isTest: isDevelopmentStore,
    returnUrl,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
  });
}

export async function cancelPaidPlan(billing: Billing, subscriptionId: string, isDevelopmentStore: boolean) {
  await billing.cancel({ subscriptionId, prorate: true, isTest: isDevelopmentStore });
}

// Derived from PLAN_ORDER — the single source of truth for both "which plans exist" and
// "what order they render in" — rather than a separately hand-maintained array. Pro was
// previously hardcoded out of this list because its feature copy made false claims (see
// DECISIONS.md's "V1 launch truthfulness pass"); now that plans.ts's Pro entry only lists
// real, deliverable capabilities, there's no reason to hide it, and no separate array to
// drift from PLAN_ORDER the next time a plan is added or removed.
export function getAllPlans(): Plan[] {
  return PLAN_ORDER.map(getPlan);
}
