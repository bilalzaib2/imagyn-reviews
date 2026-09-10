// Exercises appearanceService against a fake in-memory Appearance table — no real database.
// See product.server.test.ts for the same mocking convention this file follows. Primary focus:
// setActive's storeId ownership check, newly load-bearing now that Brand Studio's Saved Themes
// section (Pro) makes this reachable from a real form submission for the first time.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultAppearanceTokens } from "./appearance.shared";

interface FakeRow {
  id: string;
  storeId: string;
  name: string;
  preset: string;
  isActive: boolean;
  tokens: string;
  createdAt: Date;
  updatedAt: Date;
}

let rows: FakeRow[];
let nextId: number;

vi.mock("../db.server", () => ({
  default: {
    appearance: {
      findFirst: vi.fn(async (args: { where: { storeId: string; isActive?: boolean } }) => {
        return (
          rows.find(
            (row) =>
              row.storeId === args.where.storeId && (args.where.isActive === undefined || row.isActive === args.where.isActive),
          ) ?? null
        );
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => rows.find((row) => row.id === args.where.id) ?? null),
      findMany: vi.fn(async (args: { where: { storeId: string } }) => rows.filter((row) => row.storeId === args.where.storeId)),
      create: vi.fn(
        async (args: { data: { storeId: string; name: string; preset: string; isActive: boolean; tokens: string } }) => {
          const row: FakeRow = { id: `ap_${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...args.data };
          rows.push(row);
          return row;
        },
      ),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<FakeRow> }) => {
        const row = rows.find((candidate) => candidate.id === args.where.id);
        if (!row) throw new Error("Row not found");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      }),
      updateMany: vi.fn(async (args: { where: { storeId: string; isActive: boolean }; data: Partial<FakeRow> }) => {
        let count = 0;
        for (const row of rows) {
          if (row.storeId === args.where.storeId && row.isActive === args.where.isActive) {
            Object.assign(row, args.data, { updatedAt: new Date() });
            count += 1;
          }
        }
        return { count };
      }),
    },
    $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  },
}));

let overrideTokensByStoreAndSurface: Record<string, Record<string, unknown>>;
vi.mock("./surfaceBrandOverride.server", async () => {
  const actual = await vi.importActual<typeof import("./surfaceBrandOverride.server")>("./surfaceBrandOverride.server");
  return {
    ...actual,
    getSurfaceOverrideTokens: vi.fn(async (storeId: string, surfaceKey: string) => overrideTokensByStoreAndSurface[storeId]?.[surfaceKey] ?? null),
  };
});

const { appearanceService, getStorefrontAppearance } = await import("./appearance.server");

describe("getStorefrontAppearance — Global Brand -> Surface Override", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
    overrideTokensByStoreAndSurface = {};
  });

  it("returns pure global tokens (documented defaults) for a store that never configured Brand Studio", async () => {
    const tokens = await getStorefrontAppearance("store_1");
    expect(tokens).toEqual(getDefaultAppearanceTokens());
  });

  it("without a surfaceKey, ignores any override that happens to exist (existing call sites are unaffected)", async () => {
    await appearanceService.upsertActive("store_1", { tokens: getDefaultAppearanceTokens() });
    overrideTokensByStoreAndSurface.store_1 = { store_reviews: { colors: { starColor: "#00ff00" } } };

    const tokens = await getStorefrontAppearance("store_1");
    expect(tokens.colors.starColor).not.toBe("#00ff00");
  });

  it("with a surfaceKey but no override row for it, still returns pure global tokens", async () => {
    await appearanceService.upsertActive("store_1", {
      tokens: { ...getDefaultAppearanceTokens(), colors: { ...getDefaultAppearanceTokens().colors, starColor: "#123456" } },
    });

    const tokens = await getStorefrontAppearance("store_1", "review_carousel");
    expect(tokens.colors.starColor).toBe("#123456");
  });

  it("with a surfaceKey AND a real override, the override wins for exactly the fields it sets", async () => {
    await appearanceService.upsertActive("store_1", {
      tokens: { ...getDefaultAppearanceTokens(), colors: { ...getDefaultAppearanceTokens().colors, starColor: "#123456" } },
    });
    overrideTokensByStoreAndSurface.store_1 = { store_reviews: { colors: { starColor: "#00ff00" } } };

    const tokens = await getStorefrontAppearance("store_1", "store_reviews");
    expect(tokens.colors.starColor).toBe("#00ff00");
    // A sibling surface with no override for this store still gets the real global value.
    const carouselTokens = await getStorefrontAppearance("store_1", "review_carousel");
    expect(carouselTokens.colors.starColor).toBe("#123456");
  });
});

describe("appearanceService", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
  });

  it("getActive returns null when the store has never customized anything", async () => {
    expect(await appearanceService.getActive("store_1")).toBeNull();
  });

  it("upsertActive creates on first save and updates (not duplicates) on the second", async () => {
    await appearanceService.upsertActive("store_1", { tokens: getDefaultAppearanceTokens() });
    await appearanceService.upsertActive("store_1", {
      tokens: { ...getDefaultAppearanceTokens(), images: { logoUrl: "https://example.com/logo.png" } },
    });

    expect(rows).toHaveLength(1);
    expect((await appearanceService.getActive("store_1"))?.tokens.images.logoUrl).toBe("https://example.com/logo.png");
  });

  it("list only returns the requesting store's own themes", async () => {
    await appearanceService.create("store_1", { name: "Store 1 Theme", tokens: getDefaultAppearanceTokens() });
    await appearanceService.create("store_2", { name: "Store 2 Theme", tokens: getDefaultAppearanceTokens() });

    const store1Themes = await appearanceService.list("store_1");
    expect(store1Themes).toHaveLength(1);
    expect(store1Themes[0].name).toBe("Store 1 Theme");
  });

  it("create saves a new theme as inactive by default", async () => {
    const created = await appearanceService.create("store_1", { name: "Holiday", tokens: getDefaultAppearanceTokens() });
    expect(created.isActive).toBe(false);
  });

  it("setActive rejects a theme id that belongs to a different store", async () => {
    const theme = await appearanceService.create("store_1", { name: "Store 1 Theme", tokens: getDefaultAppearanceTokens() });

    await expect(appearanceService.setActive("store_2", theme.id)).rejects.toThrow("Theme not found.");
  });

  it("setActive does not deactivate or otherwise touch another store's rows", async () => {
    await appearanceService.upsertActive("store_2", { tokens: getDefaultAppearanceTokens() });
    const theme = await appearanceService.create("store_1", { name: "Store 1 Theme", tokens: getDefaultAppearanceTokens() });

    await expect(appearanceService.setActive("store_2", theme.id)).rejects.toThrow("Theme not found.");

    const store2Active = await appearanceService.getActive("store_2");
    expect(store2Active).not.toBeNull();
    expect(store2Active?.storeId).toBe("store_2");
  });

  it("setActive succeeds for the theme's own store and deactivates that store's other themes", async () => {
    const first = await appearanceService.upsertActive("store_1", { tokens: getDefaultAppearanceTokens(), name: "Default" });
    const second = await appearanceService.create("store_1", { name: "Holiday", tokens: getDefaultAppearanceTokens() });

    const activated = await appearanceService.setActive("store_1", second.id);

    expect(activated.id).toBe(second.id);
    expect(activated.isActive).toBe(true);

    const all = await appearanceService.list("store_1");
    const firstRow = all.find((row) => row.id === first.id);
    expect(firstRow?.isActive).toBe(false);
  });
});
