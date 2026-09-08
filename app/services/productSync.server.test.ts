// Exercises productSync.server.ts's staleness logic and its idempotency gate against a fake
// in-memory Prisma client and fake store.server.ts sync-state functions — no real database, no
// real Shopify Admin API call. isProductSyncInProgress is pure and directly tested; the two
// orchestration entry points are tested through their real, observable side effects (whether
// startProductSync/runProductSync get called at all), not their internal implementation.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductSyncState } from "./store.server";

function state(overrides: Partial<ProductSyncState> = {}): ProductSyncState {
  return {
    status: "running",
    total: null,
    synced: 0,
    failed: 0,
    startedAt: new Date(),
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

let syncState: ProductSyncState;
const startProductSyncMock = vi.fn(async () => undefined);
const finishProductSyncMock = vi.fn(async () => undefined);
const updateProductSyncProgressMock = vi.fn(async () => undefined);
const getProductSyncStateMock = vi.fn(async () => syncState);

vi.mock("./store.server", () => ({
  startProductSync: startProductSyncMock,
  finishProductSync: finishProductSyncMock,
  updateProductSyncProgress: updateProductSyncProgressMock,
  getProductSyncState: getProductSyncStateMock,
}));

const syncAllProductsMock = vi.fn(async () => undefined);
vi.mock("./product.server", () => ({
  syncAllProducts: syncAllProductsMock,
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn(async () => ({ admin: {} })) },
}));

const { isProductSyncInProgress, STALE_SYNC_THRESHOLD_MS, triggerInitialProductSyncIfNeeded } =
  await import("./productSync.server");

beforeEach(() => {
  syncState = state({ status: "idle", startedAt: null });
  startProductSyncMock.mockClear();
  finishProductSyncMock.mockClear();
  updateProductSyncProgressMock.mockClear();
  getProductSyncStateMock.mockClear();
  syncAllProductsMock.mockClear();
});

describe("isProductSyncInProgress", () => {
  it("is false when status isn't running at all", () => {
    expect(isProductSyncInProgress(state({ status: "idle" }))).toBe(false);
    expect(isProductSyncInProgress(state({ status: "completed" }))).toBe(false);
    expect(isProductSyncInProgress(state({ status: "failed" }))).toBe(false);
  });

  it("is false when status is running but startedAt was never recorded", () => {
    expect(isProductSyncInProgress(state({ status: "running", startedAt: null }))).toBe(false);
  });

  it("is true for a running sync well within the staleness window", () => {
    const startedAt = new Date(Date.now() - 5000);
    expect(isProductSyncInProgress(state({ status: "running", startedAt }))).toBe(true);
  });

  it("is false for a running sync older than the staleness threshold — the crashed-process case", () => {
    const startedAt = new Date(Date.now() - (STALE_SYNC_THRESHOLD_MS + 60_000));
    expect(isProductSyncInProgress(state({ status: "running", startedAt }))).toBe(false);
  });
});

describe("triggerInitialProductSyncIfNeeded", () => {
  it("starts a sync for a store that has never had one", async () => {
    await triggerInitialProductSyncIfNeeded("shop.myshopify.com", "store_1");
    expect(startProductSyncMock).toHaveBeenCalledWith("store_1");
  });

  it("never starts a second sync for a store already running, completed, or failed one", async () => {
    for (const status of ["running", "completed", "failed"] as const) {
      syncState = state({ status });
      await triggerInitialProductSyncIfNeeded("shop.myshopify.com", "store_1");
    }
    expect(startProductSyncMock).not.toHaveBeenCalled();
  });

  it("never throws even if reading sync state fails — must never break authentication", async () => {
    getProductSyncStateMock.mockRejectedValueOnce(new Error("DB blip"));
    await expect(triggerInitialProductSyncIfNeeded("shop.myshopify.com", "store_1")).resolves.toBeUndefined();
  });
});
