// Regression test for the Phase 0 embedded-app-loading fix: ensureDevelopmentStoreFlag is the
// one Shopify Admin API call app.tsx's loader makes unconditionally on a store's very first-ever
// load, with (before this fix) no try/catch above it — a thrown error here took down the whole
// embedded app, since app.tsx's ErrorBoundary had nowhere graceful to put a non-Response error.
// This locks in: a known flag never calls Shopify at all, a successful detection persists, and a
// failed detection degrades to `false` without persisting (so the very next load retries).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.server", () => ({
  default: {},
}));

const setDevelopmentStoreFlag = vi.fn(async (id: string, isDevelopmentStore: boolean) => ({ id, isDevelopmentStore }));
const updateBillingState = vi.fn(async (id: string, data: unknown) => ({ id, ...(data as object) }));
const getSlug = vi.fn((shop: string) => shop.replace(".myshopify.com", ""));
vi.mock("../store.server", () => ({
  getSlug: (shop: string) => getSlug(shop),
  updateBillingState: (id: string, data: unknown) => updateBillingState(id, data),
  setDevelopmentStoreFlag: (id: string, isDevelopmentStore: boolean) => setDevelopmentStoreFlag(id, isDevelopmentStore),
}));

import { ensureDevelopmentStoreFlag, getPricingPlansUrl, selectStarterPlan, syncBillingFromShopify } from "./billing.server";

function fakeAdmin(graphql: () => Promise<{ json: () => Promise<unknown> }>) {
  return { graphql } as unknown as Parameters<typeof ensureDevelopmentStoreFlag>[0];
}

describe("ensureDevelopmentStoreFlag", () => {
  beforeEach(() => {
    setDevelopmentStoreFlag.mockClear();
  });

  it("returns the cached flag without calling Shopify when already known", async () => {
    const graphql = vi.fn();
    const result = await ensureDevelopmentStoreFlag(fakeAdmin(graphql), { id: "store_1", isDevelopmentStore: true });

    expect(result).toBe(true);
    expect(graphql).not.toHaveBeenCalled();
    expect(setDevelopmentStoreFlag).not.toHaveBeenCalled();
  });

  it("detects and persists the flag on a store's first load", async () => {
    const graphql = vi.fn(async () => ({
      json: async () => ({ data: { shop: { plan: { partnerDevelopment: true } } } }),
    }));

    const result = await ensureDevelopmentStoreFlag(fakeAdmin(graphql), { id: "store_1", isDevelopmentStore: null });

    expect(result).toBe(true);
    expect(setDevelopmentStoreFlag).toHaveBeenCalledWith("store_1", true);
  });

  it("degrades to false without persisting when the Shopify API call throws", async () => {
    const graphql = vi.fn(async () => {
      throw new Error("Simulated Shopify throttle/network failure");
    });

    const result = await ensureDevelopmentStoreFlag(fakeAdmin(graphql), { id: "store_1", isDevelopmentStore: null });

    expect(result).toBe(false);
    expect(setDevelopmentStoreFlag).not.toHaveBeenCalled();
  });
});

// Regression coverage for this app's real, current billing mechanism — Shopify Managed
// Pricing, not the classic Billing API. Previously untested: docs/DECISIONS.md's Billing
// entry described the retired classic-API architecture, and no test here ever exercised
// syncBillingFromShopify/selectStarterPlan/getPricingPlansUrl, the three functions that
// actually implement it today.
describe("selectStarterPlan", () => {
  beforeEach(() => {
    updateBillingState.mockClear();
  });

  it("is a pure local write — no Shopify charge, since Shopify's Billing API has no free-subscription concept", async () => {
    await selectStarterPlan("store_1");

    expect(updateBillingState).toHaveBeenCalledWith("store_1", {
      plan: "starter",
      planStatus: "active",
      shopifySubscriptionId: null,
      trialEndsAt: null,
    });
  });
});

describe("getPricingPlansUrl", () => {
  it("builds the real Shopify Managed Pricing URL from the live app handle", async () => {
    const graphql = vi.fn(async () => ({
      json: async () => ({ data: { currentAppInstallation: { app: { handle: "imagyn-reviews-85" } } } }),
    }));

    const url = await getPricingPlansUrl(fakeAdmin(graphql), "verveonline.myshopify.com");

    expect(url).toBe("https://admin.shopify.com/store/verveonline/charges/imagyn-reviews-85/pricing_plans");
  });

  it("throws rather than guessing a URL when the app handle can't be resolved", async () => {
    const graphql = vi.fn(async () => ({ json: async () => ({ data: {} }) }));

    await expect(getPricingPlansUrl(fakeAdmin(graphql), "verveonline.myshopify.com")).rejects.toThrow();
  });
});

describe("syncBillingFromShopify", () => {
  beforeEach(() => {
    updateBillingState.mockClear();
  });

  function subscriptionAdmin(subscription: unknown) {
    return fakeAdmin(
      vi.fn(async () => ({
        json: async () => ({ data: { currentAppInstallation: { activeSubscriptions: subscription ? [subscription] : [] } } }),
      })),
    );
  }

  it("never reconciles an owner store back onto the normal plan ladder", async () => {
    const admin = subscriptionAdmin(null);
    await syncBillingFromShopify(admin, { id: "store_1", plan: "owner", planStatus: "active" });

    expect(updateBillingState).not.toHaveBeenCalled();
  });

  it("leaves a store with no subscription alone while it's still choosing a plan (pending)", async () => {
    await syncBillingFromShopify(subscriptionAdmin(null), { id: "store_1", plan: "starter", planStatus: "pending" });

    expect(updateBillingState).not.toHaveBeenCalled();
  });

  it("falls back a previously-paid store with no subscription to free Starter", async () => {
    await syncBillingFromShopify(subscriptionAdmin(null), { id: "store_1", plan: "growth", planStatus: "active" });

    expect(updateBillingState).toHaveBeenCalledWith("store_1", {
      plan: "starter",
      planStatus: "active",
      shopifySubscriptionId: null,
      trialEndsAt: null,
    });
  });

  it("activates a real ACTIVE subscription with no trial as Growth/active", async () => {
    await syncBillingFromShopify(
      subscriptionAdmin({ id: "gid://sub/1", name: "Growth", status: "ACTIVE", test: false, trialDays: 0, createdAt: "2026-01-01T00:00:00Z" }),
      { id: "store_1", plan: "starter", planStatus: "pending" },
    );

    expect(updateBillingState).toHaveBeenCalledWith("store_1", {
      plan: "growth",
      planStatus: "active",
      shopifySubscriptionId: "gid://sub/1",
      trialEndsAt: null,
    });
  });

  it("recognizes an active trial window and marks the store trialing, not active", async () => {
    const createdAt = new Date().toISOString();
    await syncBillingFromShopify(
      subscriptionAdmin({ id: "gid://sub/1", name: "Growth", status: "ACTIVE", test: false, trialDays: 14, createdAt }),
      { id: "store_1", plan: "starter", planStatus: "pending" },
    );

    const call = updateBillingState.mock.calls[0][1] as { planStatus: string; trialEndsAt: Date };
    expect(call.planStatus).toBe("trialing");
    expect(call.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("maps a real 'scale' subscription name to the retired-but-still-honored scale PlanId", async () => {
    await syncBillingFromShopify(
      subscriptionAdmin({ id: "gid://sub/1", name: "Scale", status: "ACTIVE", test: false, trialDays: 0, createdAt: "2026-01-01T00:00:00Z" }),
      { id: "store_1", plan: "scale", planStatus: "active" },
    );

    expect(updateBillingState).toHaveBeenCalledWith("store_1", expect.objectContaining({ plan: "scale" }));
  });

  it("marks a FROZEN subscription (payment failure) as frozen, not cancelled", async () => {
    await syncBillingFromShopify(
      subscriptionAdmin({ id: "gid://sub/1", name: "Growth", status: "FROZEN", test: false, trialDays: 0, createdAt: "2026-01-01T00:00:00Z" }),
      { id: "store_1", plan: "growth", planStatus: "active" },
    );

    expect(updateBillingState).toHaveBeenCalledWith("store_1", expect.objectContaining({ planStatus: "frozen" }));
  });

  it("leaves a PENDING subscription alone — Shopify hasn't finished activating it yet", async () => {
    await syncBillingFromShopify(
      subscriptionAdmin({ id: "gid://sub/1", name: "Growth", status: "PENDING", test: false, trialDays: 0, createdAt: "2026-01-01T00:00:00Z" }),
      { id: "store_1", plan: "starter", planStatus: "pending" },
    );

    expect(updateBillingState).not.toHaveBeenCalled();
  });

  it.each(["CANCELLED", "DECLINED", "EXPIRED"] as const)(
    "falls a %s subscription back to free Starter",
    async (status) => {
      await syncBillingFromShopify(
        subscriptionAdmin({ id: "gid://sub/1", name: "Growth", status, test: false, trialDays: 0, createdAt: "2026-01-01T00:00:00Z" }),
        { id: "store_1", plan: "growth", planStatus: "active" },
      );

      expect(updateBillingState).toHaveBeenCalledWith("store_1", {
        plan: "starter",
        planStatus: "active",
        shopifySubscriptionId: null,
        trialEndsAt: null,
      });
    },
  );
});
