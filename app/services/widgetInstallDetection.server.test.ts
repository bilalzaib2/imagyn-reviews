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

  it("reports unknown, not not-installed, for a password-protected storefront", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => redirectToPassword());

    const result = await detectWidgetInstallStatus("shop.example.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("unknown");
    expect(result["product-reviews-widget"].reason).toMatch(/password protection/);
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

describe("detectWidgetInstallStatus — manual verification overrides", () => {
  it("overrides live detection for a known unreachable store's shop domain", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => redirectToPassword());

    const result = await detectWidgetInstallStatus("verveonline.myshopify.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("installed");
    expect(result["product-rating-badge"].state).toBe("installed");
    expect(result["collection-rating-badge"].state).toBe("installed");
    expect(result["review-carousel"].state).toBe("not-installed");
  });

  it("never applies an override for a store not in the list", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => htmlResponse("<html>nothing</html>"));

    const result = await detectWidgetInstallStatus("some-other-shop.myshopify.com", "store_1");
    expect(result["product-reviews-widget"].state).toBe("not-installed");
  });
});
