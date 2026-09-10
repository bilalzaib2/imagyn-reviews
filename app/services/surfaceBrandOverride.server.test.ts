// Exercises the Surface-Specific Override layer against a fake in-memory Prisma client — no
// real database. Covers the exact regression list from the Global Brand System spec: override
// wins over global default, reset restores the global default, and one merchant can never see
// or affect another merchant's override for the same surface key.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultAppearanceTokens } from "./appearance.shared";

interface FakeOverrideRow {
  id: string;
  storeId: string;
  surfaceKey: string;
  tokens: string;
}

let rows: FakeOverrideRow[];
let nextId = 1;

vi.mock("../db.server", () => ({
  default: {
    surfaceBrandOverride: {
      findUnique: vi.fn(async ({ where }: { where: { storeId_surfaceKey: { storeId: string; surfaceKey: string } } }) => {
        const { storeId, surfaceKey } = where.storeId_surfaceKey;
        return rows.find((r) => r.storeId === storeId && r.surfaceKey === surfaceKey) ?? null;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { storeId_surfaceKey: { storeId: string; surfaceKey: string } };
          create: { storeId: string; surfaceKey: string; tokens: string };
          update: { tokens: string };
        }) => {
          const { storeId, surfaceKey } = where.storeId_surfaceKey;
          const existing = rows.find((r) => r.storeId === storeId && r.surfaceKey === surfaceKey);
          if (existing) {
            existing.tokens = update.tokens;
            return existing;
          }
          const row = { id: String(nextId++), ...create };
          rows.push(row);
          return row;
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where: { storeId: string; surfaceKey: string } }) => {
        const before = rows.length;
        rows = rows.filter((r) => !(r.storeId === where.storeId && r.surfaceKey === where.surfaceKey));
        return { count: before - rows.length };
      }),
    },
  },
}));

const {
  getSurfaceOverrideTokens,
  hasSurfaceOverride,
  setSurfaceOverride,
  resetSurfaceOverride,
  resolveSurfaceTokens,
} = await import("./surfaceBrandOverride.server");

beforeEach(() => {
  rows = [];
  nextId = 1;
});

describe("setSurfaceOverride / getSurfaceOverrideTokens", () => {
  it("has no override for a surface that was never touched", async () => {
    expect(await getSurfaceOverrideTokens("store_1", "store_reviews")).toBeNull();
    expect(await hasSurfaceOverride("store_1", "store_reviews")).toBe(false);
  });

  it("persists a real, partial override for exactly the surface it was set for", async () => {
    await setSurfaceOverride("store_1", "store_reviews", { colors: { starColor: "#00ff00" } as never });

    expect(await hasSurfaceOverride("store_1", "store_reviews")).toBe(true);
    expect(await getSurfaceOverrideTokens("store_1", "store_reviews")).toEqual({ colors: { starColor: "#00ff00" } });
    // A different surface for the same store is untouched.
    expect(await hasSurfaceOverride("store_1", "review_carousel")).toBe(false);
  });

  it("overwrites the same (store, surface) pair on a second save, never duplicating rows", async () => {
    await setSurfaceOverride("store_1", "store_reviews", { colors: { starColor: "#00ff00" } as never });
    await setSurfaceOverride("store_1", "store_reviews", { colors: { starColor: "#0000ff" } as never });

    expect(await getSurfaceOverrideTokens("store_1", "store_reviews")).toEqual({ colors: { starColor: "#0000ff" } });
  });
});

describe("resetSurfaceOverride — Reset to Brand Studio", () => {
  it("deletes the row entirely, not just clears its tokens", async () => {
    await setSurfaceOverride("store_1", "store_reviews", { colors: { starColor: "#00ff00" } as never });
    await resetSurfaceOverride("store_1", "store_reviews");

    expect(await getSurfaceOverrideTokens("store_1", "store_reviews")).toBeNull();
    expect(await hasSurfaceOverride("store_1", "store_reviews")).toBe(false);
  });

  it("is a safe no-op when the surface never had an override", async () => {
    await expect(resetSurfaceOverride("store_1", "store_reviews")).resolves.not.toThrow();
  });
});

describe("tenant isolation — Merchant A cannot access Merchant B's override", () => {
  it("a store never sees another store's override for the identical surface key", async () => {
    await setSurfaceOverride("store_A", "trust_badge", { colors: { starColor: "#111111" } as never });

    expect(await getSurfaceOverrideTokens("store_B", "trust_badge")).toBeNull();
    expect(await hasSurfaceOverride("store_B", "trust_badge")).toBe(false);
    // Store A's own override is unaffected by store B ever being queried.
    expect(await getSurfaceOverrideTokens("store_A", "trust_badge")).toEqual({ colors: { starColor: "#111111" } });
  });

  it("resetting store B's (non-existent) override never touches store A's real one", async () => {
    await setSurfaceOverride("store_A", "trust_badge", { colors: { starColor: "#111111" } as never });
    await resetSurfaceOverride("store_B", "trust_badge");

    expect(await getSurfaceOverrideTokens("store_A", "trust_badge")).toEqual({ colors: { starColor: "#111111" } });
  });
});

describe("resolveSurfaceTokens — Global Brand -> Surface Override -> Final Rendered Style", () => {
  it("returns pure global tokens when there is no override (a brand-new future surface's exact scenario)", () => {
    const global = getDefaultAppearanceTokens();
    expect(resolveSurfaceTokens(global, null)).toEqual(global);
  });

  it("an override wins over the global default for exactly the fields it sets", () => {
    const global = { ...getDefaultAppearanceTokens(), colors: { ...getDefaultAppearanceTokens().colors, starColor: "#f5a623" } };
    const resolved = resolveSurfaceTokens(global, { colors: { starColor: "#00ff00" } as never });

    expect(resolved.colors.starColor).toBe("#00ff00");
    // Every other field still comes from global, untouched by the override.
    expect(resolved.corners.radius).toBe(global.corners.radius);
    expect(resolved.buttons.style).toBe(global.buttons.style);
  });

  it("a later global brand change shows through immediately on every field the override never touched", () => {
    const overrideTokens = { colors: { starColor: "#00ff00" } as never };
    const globalBefore = { ...getDefaultAppearanceTokens(), corners: { radius: 4 } };
    const globalAfter = { ...getDefaultAppearanceTokens(), corners: { radius: 20 } };

    expect(resolveSurfaceTokens(globalBefore, overrideTokens).corners.radius).toBe(4);
    expect(resolveSurfaceTokens(globalAfter, overrideTokens).corners.radius).toBe(20);
    // The overridden field never changes regardless of the global brand update.
    expect(resolveSurfaceTokens(globalAfter, overrideTokens).colors.starColor).toBe("#00ff00");
  });
});
