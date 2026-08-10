// Exercises widgetService's storeId scoping/ownership checks and
// getStorefrontWidgetSettings's Pro-layout coercion against a fake in-memory Widget table —
// no real database. See product.server.test.ts for the same mocking convention this follows.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultWidgetSettings } from "./widget.shared";

interface FakeRow {
  id: string;
  storeId: string;
  productId: string | null;
  name: string;
  type: string;
  settings: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let rows: FakeRow[];
let nextId: number;

vi.mock("../db.server", () => ({
  default: {
    widget: {
      findMany: vi.fn(async (args: { where: { storeId: string; productId?: string } }) => {
        return rows.filter(
          (row) =>
            row.storeId === args.where.storeId &&
            (args.where.productId === undefined || row.productId === args.where.productId),
        );
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return rows.find((row) => row.id === args.where.id) ?? null;
      }),
      create: vi.fn(
        async (args: {
          data: { storeId: string; productId: string | null; name: string; type: string; settings: string };
        }) => {
          const row: FakeRow = { id: `w_${nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...args.data };
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
      delete: vi.fn(async (args: { where: { id: string } }) => {
        rows = rows.filter((row) => row.id !== args.where.id);
        return {};
      }),
    },
  },
}));

const { widgetService, getStorefrontWidgetSettings } = await import("./widget.server");

describe("widgetService — storeId scoping", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
    vi.clearAllMocks();
  });

  it("listWidgets only returns the requesting store's own widgets", async () => {
    await widgetService.createWidget({ storeId: "store_1", name: "Store 1 Widget", type: "review-list", settings: getDefaultWidgetSettings("review-list") });
    await widgetService.createWidget({ storeId: "store_2", name: "Store 2 Widget", type: "review-list", settings: getDefaultWidgetSettings("review-list") });

    const store1Widgets = await widgetService.listWidgets("store_1");

    expect(store1Widgets).toHaveLength(1);
    expect(store1Widgets[0].name).toBe("Store 1 Widget");
  });

  it("updateWidget rejects a widget id that belongs to a different store", async () => {
    const widget = await widgetService.createWidget({
      storeId: "store_1",
      name: "Store 1 Widget",
      type: "review-list",
      settings: getDefaultWidgetSettings("review-list"),
    });

    await expect(
      widgetService.updateWidget("store_2", widget.id, { name: "Hijacked" }),
    ).rejects.toThrow("Widget not found.");

    // The widget itself must be genuinely untouched, not just rejected with a stale echo.
    const stillOwned = await widgetService.listWidgets("store_1");
    expect(stillOwned[0].name).toBe("Store 1 Widget");
  });

  it("deleteWidget rejects a widget id that belongs to a different store, and does not delete it", async () => {
    const widget = await widgetService.createWidget({
      storeId: "store_1",
      name: "Store 1 Widget",
      type: "review-list",
      settings: getDefaultWidgetSettings("review-list"),
    });

    await expect(widgetService.deleteWidget("store_2", widget.id)).rejects.toThrow("Widget not found.");
    expect(await widgetService.listWidgets("store_1")).toHaveLength(1);
  });

  it("duplicateWidget rejects a widget id that belongs to a different store", async () => {
    const widget = await widgetService.createWidget({
      storeId: "store_1",
      name: "Store 1 Widget",
      type: "review-list",
      settings: getDefaultWidgetSettings("review-list"),
    });

    await expect(widgetService.duplicateWidget("store_2", widget.id)).rejects.toThrow("Widget not found.");
  });

  it("resetWidget rejects a widget id that belongs to a different store", async () => {
    const widget = await widgetService.createWidget({
      storeId: "store_1",
      name: "Store 1 Widget",
      type: "review-list",
      settings: { ...getDefaultWidgetSettings("review-list"), showVerifiedBadge: false },
    });

    await expect(widgetService.resetWidget("store_2", widget.id)).rejects.toThrow("Widget not found.");

    const stillCustomized = await widgetService.listWidgets("store_1");
    expect(stillCustomized[0].settings.showVerifiedBadge).toBe(false);
  });

  it("updateWidget succeeds for the widget's own store", async () => {
    const widget = await widgetService.createWidget({
      storeId: "store_1",
      name: "Original",
      type: "review-list",
      settings: getDefaultWidgetSettings("review-list"),
    });

    const updated = await widgetService.updateWidget("store_1", widget.id, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
  });
});

describe("getStorefrontWidgetSettings — Pro layout coercion", () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
  });

  it("coerces a saved 'grid' layout back to 'list' for a non-Pro store", async () => {
    await widgetService.createWidget({
      storeId: "store_1",
      name: "Reviews",
      type: "review-list",
      settings: { ...getDefaultWidgetSettings("review-list"), layout: "grid" },
    });

    const result = await getStorefrontWidgetSettings("store_1", "product_1", "review-list", false);
    expect(result.settings.layout).toBe("list");
  });

  it("preserves a saved 'grid' layout for a Pro store", async () => {
    await widgetService.createWidget({
      storeId: "store_1",
      name: "Reviews",
      type: "review-list",
      settings: { ...getDefaultWidgetSettings("review-list"), layout: "grid" },
    });

    const result = await getStorefrontWidgetSettings("store_1", "product_1", "review-list", true);
    expect(result.settings.layout).toBe("grid");
  });

  it("defaults to 'list' (harmless either way) when the store has never saved a widget", async () => {
    const result = await getStorefrontWidgetSettings("store_never_customized", "product_1", "review-list", false);
    expect(result.settings.layout).toBe("list");
  });
});
