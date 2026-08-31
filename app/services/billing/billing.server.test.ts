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

const setDevelopmentStoreFlag = vi.fn(async () => ({}));
vi.mock("../store.server", () => ({
  getSlug: vi.fn(),
  updateBillingState: vi.fn(),
  setDevelopmentStoreFlag: (...args: unknown[]) => setDevelopmentStoreFlag(...args),
}));

import { ensureDevelopmentStoreFlag } from "./billing.server";

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
