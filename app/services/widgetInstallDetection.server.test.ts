// Exercises detectWidgetInstallStatus's real marker-detection logic against a mocked global
// fetch and a fake Prisma client — no real network, no real database. Confirms each of the
// three detection strategies (section/embed/homepage-only) and the manual-override escape
// hatch behave exactly as their own comments in widgetInstallDetection.server.ts describe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let productHandle: string | null;

vi.mock("../db.server", () => ({
  default: {
    product: {
      findFirst: vi.fn(async () => (productHandle ? { handle: productHandle } : null)),
    },
  },
}));

const { detectWidgetInstallStatus } = await import("./widgetInstallDetection.server");

function htmlResponse(body: string, init: Partial<{ status: number; headers: Record<string, string> }> = {}) {
  return new Response(body, { status: init.status ?? 200, headers: init.headers });
}

function redirectToPassword() {
  return new Response(null, { status: 302, headers: { location: "https://shop.example.com/password" } });
}

beforeEach(() => {
  productHandle = "blue-widget";
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectWidgetInstallStatus — section-target widgets (product page)", () => {
  it("reports installed when the product page HTML contains the block's marker", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url.includes("/products/")
        ? htmlResponse('<div data-imagyn-reviews="true"></div>')
        : htmlResponse("<html></html>"),
    );

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("installed");
  });

  it("reports not-installed when the product page is reachable but has no marker", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => htmlResponse("<html>no markers here</html>"));

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("not-installed");
    expect(result["product-rating-badge"].state).toBe("not-installed");
  });

  it("reports unknown with a real reason when the store has no synced products", async () => {
    productHandle = null;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => htmlResponse("<html></html>"));

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("unknown");
    expect(result["product-reviews-widget"].reason).toMatch(/no synced products/);
  });

  it("reports unknown when the storefront can't be reached at all", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("unknown");
    expect(result["product-reviews-widget"].reason).toMatch(/Couldn't reach/);
  });

  it("reports blocked, not not-installed, for a password-protected storefront", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => redirectToPassword());

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    // Its own state, not a flavour of "unknown": a development-plan store cannot switch
    // password protection off, so this never resolves on its own and calls for different
    // merchant guidance than a failed fetch does.
    expect(result["product-reviews-widget"].state).toBe("blocked");
    expect(result["product-reviews-widget"].reason).toMatch(/password protection/);
  });

  // Regression guard. This store's entries in a hardcoded MANUAL_VERIFICATION_OVERRIDES table
  // used to assert "installed" for four blocks on the strength of a Theme Editor check from
  // 2026-08-16 against theme 150727819563 — while the CLI now reports the host theme as
  // 193495335211. A claim sourced from a stale manual note is not evidence, and the app must
  // not present one as a live detection result.
  it("never claims installation for a store it could not actually read", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => redirectToPassword());

    const result = await detectWidgetInstallStatus("verveonline.myshopify.com", "store_1");

    for (const [key, status] of Object.entries(result)) {
      expect(status.state, `${key} must not claim installation behind a password`).not.toBe("installed");
    }
  });

  it("detects the standalone AI Review Summary block by its own marker, independent of the other product-page blocks", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url.includes("/products/")
        ? htmlResponse('<div data-imagyn-ai-summary-block="true"></div>')
        : htmlResponse("<html></html>"),
    );

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["ai-review-summary"].state).toBe("installed");
    expect(result["product-rating-badge"].state).toBe("not-installed");
  });
});

describe("detectWidgetInstallStatus — embed widget (collection rating badge)", () => {
  it("is installed if the marker is found on either the home or product page", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url.includes("/products/")
        ? htmlResponse('<div data-imagyn-collection-badges="true"></div>')
        : htmlResponse("<html>no marker</html>"),
    );

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["collection-rating-badge"].state).toBe("installed");
  });

  it("is not-installed when neither reachable page has the marker", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => htmlResponse("<html>nothing</html>"));

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["collection-rating-badge"].state).toBe("not-installed");
  });
});

describe("detectWidgetInstallStatus — homepage-only widgets (review carousel)", () => {
  it("is installed when the homepage has the marker", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url.endsWith("/") ? htmlResponse('<div data-imagyn-carousel="true"></div>') : htmlResponse("<html></html>"),
    );

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["review-carousel"].state).toBe("installed");
  });

  it("stays unknown (never a false 'not installed') when the homepage lacks the marker, since the block can live on any page", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => htmlResponse("<html>no carousel here</html>"));

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["review-carousel"].state).toBe("unknown");
    expect(result["review-carousel"].reason).toMatch(/Review Carousel can be added to any page/);
  });
});

describe("detectWidgetInstallStatus — no store is ever special-cased", () => {
  // This file used to assert the opposite: that a hardcoded MANUAL_VERIFICATION_OVERRIDES
  // table reported four blocks as "installed" for verveonline.myshopify.com even behind a
  // password wall. The evidence behind those entries was a Theme Editor check from 2026-08-16
  // against theme 150727819563, and the Shopify CLI now reports the host theme as
  // 193495335211 — a different theme. A months-old manual note about a theme that may no
  // longer be active is not evidence, and the app must not render it as a live detection
  // result. The table and its applier are gone; these tests pin that they stay gone.
  it("does not claim installation for the store that used to be overridden", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => redirectToPassword());

    const result = await detectWidgetInstallStatus("verveonline.myshopify.com", "store_1");

    expect(result["product-reviews-widget"].state).toBe("blocked");
    expect(result["product-rating-badge"].state).toBe("blocked");
    expect(result["collection-rating-badge"].state).toBe("blocked");
  });

  it("treats every shop domain identically", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => htmlResponse("<html>nothing</html>"));

    const overridden = await detectWidgetInstallStatus("verveonline.myshopify.com", "store_1");
    const other = await detectWidgetInstallStatus("some-other-shop.myshopify.com", "store_1");

    expect(overridden["product-reviews-widget"].state).toBe("not-installed");
    expect(other["product-reviews-widget"].state).toBe("not-installed");
  });
});
