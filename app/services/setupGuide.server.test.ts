// The fresh-install checklist.
//
// Two things are being protected here. First, that the one step without which the product
// does nothing — getting a widget onto the storefront — is actually on the list; it was
// missing entirely until 2026-11-08, so a new merchant could tick every box and still have a
// storefront showing no reviews.
//
// Second, that no box can be ticked by something the merchant did not do. The checklist reads
// real signals only, and each label must claim no more than its signal proves.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeFindUniqueOrThrow = vi.fn();
const reviewCount = vi.fn();
const requestCount = vi.fn();
const widgetCount = vi.fn();
const getActive = vi.fn();

vi.mock("../db.server", () => ({
  default: {
    store: {
      get findUniqueOrThrow() {
        return storeFindUniqueOrThrow;
      },
    },
    review: {
      get count() {
        return reviewCount;
      },
    },
    reviewRequest: {
      get count() {
        return requestCount;
      },
    },
    widget: {
      get count() {
        return widgetCount;
      },
    },
  },
}));

vi.mock("./appearance.server", () => ({
  appearanceService: {
    getActive: (...args: unknown[]) => getActive(...args),
  },
}));

const { getSetupGuideItems } = await import("./setupGuide.server");

/** A brand-new install: nothing done, nothing configured. */
function freshInstall() {
  storeFindUniqueOrThrow.mockResolvedValue({ planStatus: "pending" });
  reviewCount.mockResolvedValue(0);
  requestCount.mockResolvedValue(0);
  widgetCount.mockResolvedValue(0);
  getActive.mockResolvedValue(null);
}

beforeEach(() => {
  [storeFindUniqueOrThrow, reviewCount, requestCount, widgetCount, getActive].forEach((fn) => fn.mockReset());
  freshInstall();
});

describe("a brand-new install", () => {
  it("has nothing ticked", async () => {
    const items = await getSetupGuideItems("store_1");
    expect(items.every((item) => !item.done)).toBe(true);
  });

  it("tells the merchant to set up the widget", async () => {
    // Without this step the storefront shows nothing, no shopper can leave a review, and
    // every other task on the list is preparation for an audience of nobody.
    const items = await getSetupGuideItems("store_1");
    expect(items.map((item) => item.key)).toContain("widget");
  });

  it("puts the widget step near the top, not buried", async () => {
    const items = await getSetupGuideItems("store_1");
    expect(items.findIndex((item) => item.key === "widget")).toBeLessThanOrEqual(1);
  });

  it("points every step at a route that exists", async () => {
    const items = await getSetupGuideItems("store_1");
    for (const item of items) {
      const route = item.href.replace(/^\/app\/?/, "");
      const file = route ? `app/routes/app.${route.replace(/\//g, ".")}.tsx` : "app/routes/app._index.tsx";
      expect(() => readFileSync(file, "utf8"), `${item.key} -> ${item.href}`).not.toThrow();
    }
  });

  it("gives every step a label and a description", async () => {
    const items = await getSetupGuideItems("store_1");
    for (const item of items) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("no box is ticked by something the merchant did not do", () => {
  it("ticks the widget step only once a widget is configured", async () => {
    widgetCount.mockResolvedValue(1);
    const items = await getSetupGuideItems("store_1");
    expect(items.find((item) => item.key === "widget")!.done).toBe(true);
  });

  it("does not claim the widget is live on the storefront", async () => {
    // The app has no read_themes scope, so it cannot know. The label must not imply it does.
    const items = await getSetupGuideItems("store_1");
    const widget = items.find((item) => item.key === "widget")!;
    expect(widget.label).not.toMatch(/live|installed|added to (your )?theme|on your storefront/i);
    // ...and the part we cannot verify is stated as an instruction instead.
    expect(widget.description).toMatch(/add the widget to your theme/i);
  });

  it.each([
    ["plan", () => storeFindUniqueOrThrow.mockResolvedValue({ planStatus: "active" })],
    ["reviews", () => reviewCount.mockResolvedValue(3)],
    ["requests", () => requestCount.mockResolvedValue(2)],
    ["brand", () => getActive.mockResolvedValue({ id: "appearance_1" })],
  ])("ticks %s only on its own real signal", async (key, arrange) => {
    arrange();
    const items = await getSetupGuideItems("store_1");

    expect(items.find((item) => item.key === key)!.done).toBe(true);
    // Exactly one box moved.
    expect(items.filter((item) => item.done)).toHaveLength(1);
  });
});

describe("the checklist is scoped to one store", () => {
  it("counts only this store's reviews, requests and widgets", async () => {
    await getSetupGuideItems("store_1");
    for (const mock of [reviewCount, requestCount, widgetCount]) {
      expect(mock.mock.calls[0][0].where.storeId).toBe("store_1");
    }
  });
});

describe("a fully set-up store", () => {
  // Carried over from the original suite: with every real signal present, nothing is left
  // nagging the merchant. The widget signal joins the others here.
  it("marks everything done once every real signal is present", async () => {
    storeFindUniqueOrThrow.mockResolvedValue({ planStatus: "active" });
    reviewCount.mockResolvedValue(5);
    requestCount.mockResolvedValue(2);
    widgetCount.mockResolvedValue(1);
    getActive.mockResolvedValue({ id: "appearance_1" });

    const items = await getSetupGuideItems("store_1");
    expect(items.every((item) => item.done)).toBe(true);
  });
});
