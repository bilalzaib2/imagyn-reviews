import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CAROUSEL_SETTINGS, applyCarouselPreset } from "./carouselSettings.shared";
import { getDefaultWidgetSettings } from "./widget.shared";

/**
 * Carousel customization persistence.
 *
 * Deliberately exercised through an in-memory stand-in for the widget table rather than a real
 * database, because what matters here is the behaviour the merchant depends on — a first save
 * creating the row, settings surviving a reload, one store never seeing another's, and values
 * being clamped on the way in regardless of what the form sent.
 */
type Row = { id: string; storeId: string; productId: string | null; name: string; type: string; settings: string };

let rows: Row[] = [];
let nextId = 1;

vi.mock("../db.server", () => ({
  default: {
    widget: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string; productId?: string | null } }) =>
        rows.filter(
          (row) =>
            row.storeId === where.storeId &&
            (where.productId === undefined || row.productId === (where.productId ?? null)),
        ),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) =>
        rows.find((row) => row.id === where.id && row.storeId === where.storeId) ?? null,
      ),
      // findOwnedWidgetOrThrow reads by id alone and compares storeId itself — that comparison
      // is the tenant check, so the mock must not filter by storeId here or the test would be
      // asserting against a stricter fake than the real query.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id"> }) => {
        const row = { ...data, id: `w${nextId++}`, productId: data.productId ?? null };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      delete: vi.fn(async () => ({})),
    },
  },
}));

const { getCarouselCustomization, saveCarouselCustomization } = await import("./widget.server");

beforeEach(() => {
  rows = [];
  nextId = 1;
});

describe("first save", () => {
  it("creates the store-wide carousel row rather than requiring one to exist", async () => {
    await saveCarouselCustomization("store_1", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 24 });

    expect(rows).toHaveLength(1);
    expect(rows[0].storeId).toBe("store_1");
    expect(rows[0].type).toBe("review-carousel");
    expect(rows[0].productId).toBeNull();
  });

  it("a store that has never saved still gets working defaults", async () => {
    expect(await getCarouselCustomization("store_never_saved")).toEqual(DEFAULT_CAROUSEL_SETTINGS);
  });
});

describe("settings round-trip", () => {
  it("saves and reloads exactly what the merchant chose", async () => {
    const chosen = { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 20, cardsDesktop: 4, showDate: false, starColor: "#5c9754" };

    await saveCarouselCustomization("store_1", chosen);

    expect(await getCarouselCustomization("store_1")).toEqual(chosen);
  });

  it("updates the same row instead of creating a second one", async () => {
    await saveCarouselCustomization("store_1", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 10 });
    await saveCarouselCustomization("store_1", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 30 });

    expect(rows).toHaveLength(1);
    expect((await getCarouselCustomization("store_1")).cardRadius).toBe(30);
  });

  it.each(["minimal", "editorial", "modern", "image-focused", "compact"])(
    "the %s preset survives a save and reload",
    async (id) => {
      const applied = applyCarouselPreset(DEFAULT_CAROUSEL_SETTINGS, id);

      await saveCarouselCustomization("store_1", applied);

      expect(await getCarouselCustomization("store_1")).toEqual(applied);
    },
  );

  it("preserves the rest of the widget row, so saving the carousel loses nothing else", async () => {
    rows.push({
      id: "w0",
      storeId: "store_1",
      productId: null,
      name: "Review Carousel",
      type: "review-carousel",
      settings: JSON.stringify({ ...getDefaultWidgetSettings("review-carousel"), widgetName: "My carousel", enabled: true }),
    });

    await saveCarouselCustomization("store_1", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 18 });

    expect(JSON.parse(rows[0].settings).widgetName).toBe("My carousel");
    expect(JSON.parse(rows[0].settings).carousel.cardRadius).toBe(18);
  });
});

describe("values are clamped on the way in, not merely in the browser", () => {
  it("a hostile or broken form cannot store an unusable value", async () => {
    await saveCarouselCustomization("store_1", {
      cardRadius: 9999,
      cardsDesktop: 99,
      bodyFontSize: -40,
      cardBackground: "red; background: url(https://evil.example/x)",
    });

    const saved = await getCarouselCustomization("store_1");

    expect(saved.cardRadius).toBe(32);
    expect(saved.cardsDesktop).toBe(6);
    expect(saved.bodyFontSize).toBe(11);
    expect(saved.cardBackground).toBe(DEFAULT_CAROUSEL_SETTINGS.cardBackground);
  });

  it("garbage input saves as defaults rather than failing", async () => {
    await saveCarouselCustomization("store_1", "not an object");

    expect(await getCarouselCustomization("store_1")).toEqual(DEFAULT_CAROUSEL_SETTINGS);
  });
});

describe("tenant isolation", () => {
  it("one store's customization is invisible to another", async () => {
    await saveCarouselCustomization("store_1", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 28 });
    await saveCarouselCustomization("store_2", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 4 });

    expect((await getCarouselCustomization("store_1")).cardRadius).toBe(28);
    expect((await getCarouselCustomization("store_2")).cardRadius).toBe(4);
  });

  it("a store with no row is unaffected by another store's save", async () => {
    await saveCarouselCustomization("store_1", { ...DEFAULT_CAROUSEL_SETTINGS, cardRadius: 28 });

    expect(await getCarouselCustomization("store_3")).toEqual(DEFAULT_CAROUSEL_SETTINGS);
  });

  it("every stored row carries its own storeId", async () => {
    await saveCarouselCustomization("store_1", DEFAULT_CAROUSEL_SETTINGS);
    await saveCarouselCustomization("store_2", DEFAULT_CAROUSEL_SETTINGS);

    expect(rows.map((r) => r.storeId).sort()).toEqual(["store_1", "store_2"]);
  });
});

describe("configurations saved before a control existed", () => {
  it("pick up the new control's default instead of breaking", async () => {
    rows.push({
      id: "w0",
      storeId: "store_1",
      productId: null,
      name: "Review Carousel",
      type: "review-carousel",
      // An older shape: only the handful of settings that existed at the time.
      settings: JSON.stringify({
        ...getDefaultWidgetSettings("review-carousel"),
        enabled: true,
        carousel: { cardsDesktop: 2, showRating: false },
      }),
    });

    const loaded = await getCarouselCustomization("store_1");

    expect(loaded.cardsDesktop).toBe(2);
    expect(loaded.showRating).toBe(false);
    expect(loaded.imagePosition).toBe(DEFAULT_CAROUSEL_SETTINGS.imagePosition);
    expect(loaded.cardShadow).toBe(DEFAULT_CAROUSEL_SETTINGS.cardShadow);
  });
});
