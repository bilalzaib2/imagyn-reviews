// Shopify brand-logo sync.
//
// Two things matter here and both are security- or correctness-shaped rather than cosmetic:
//
//  1. The URL ends up inside an email `<img src>`, so validation happens at that boundary even
//     though Shopify is a trusted source. "Trusted" is not "skip validation".
//  2. A Shopify API failure must degrade to the stored value and never break a page load — the
//     sync is fire-and-forget from app.tsx's loader, which every /app/* screen goes through.
import { beforeEach, describe, expect, it, vi } from "vitest";

const setShopBrandLogo = vi.fn(async (id: string, url: string | null, syncedAt: Date) => ({ id, url, syncedAt }));

vi.mock("./store.server", () => ({
  setShopBrandLogo: (id: string, url: string | null, syncedAt: Date) => setShopBrandLogo(id, url, syncedAt),
}));

const { ensureShopBrandLogo, fetchShopBrandLogo, isUsableLogoUrl, SHOP_BRAND_LOGO_TTL_MS } = await import(
  "./shopBrandLogo.server"
);

function admin(payload: unknown) {
  return {
    graphql: vi.fn(async () => ({ json: async () => payload })),
  } as unknown as Parameters<typeof fetchShopBrandLogo>[0];
}

function brandPayload(logo: string | null, squareLogo: string | null = null) {
  return {
    data: {
      shop: {
        brand: {
          logo: logo ? { image: { url: logo } } : null,
          squareLogo: squareLogo ? { image: { url: squareLogo } } : null,
        },
      },
    },
  };
}

const NOW = new Date("2026-11-05T12:00:00Z");

beforeEach(() => {
  setShopBrandLogo.mockClear();
});

describe("isUsableLogoUrl — this value becomes an email img src", () => {
  it("accepts a normal https Shopify CDN URL", () => {
    expect(isUsableLogoUrl("https://cdn.shopify.com/s/files/1/brand/logo.png")).toBe(true);
  });

  // http is rejected because an email client either blocks it or warns on mixed content.
  it("rejects http", () => {
    expect(isUsableLogoUrl("http://cdn.shopify.com/logo.png")).toBe(false);
  });

  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,iVBORw0KGgo=",
    "ftp://example.com/logo.png",
    "//cdn.shopify.com/logo.png",
    "cdn.shopify.com/logo.png",
    "",
    "   ",
  ])("rejects %j", (value) => {
    expect(isUsableLogoUrl(value)).toBe(false);
  });

  // Anything that could break out of the attribute and inject further markup.
  it.each([
    'https://cdn.shopify.com/logo.png" onerror="alert(1)',
    "https://cdn.shopify.com/logo.png' />",
    "https://cdn.shopify.com/lo go.png",
    "https://cdn.shopify.com/logo.png<script>",
  ])("rejects attribute-breaking value %j", (value) => {
    expect(isUsableLogoUrl(value)).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isUsableLogoUrl(null)).toBe(false);
    expect(isUsableLogoUrl(undefined)).toBe(false);
  });

  it("rejects an absurdly long URL rather than bloating every email body", () => {
    expect(isUsableLogoUrl(`https://cdn.shopify.com/${"a".repeat(3000)}.png`)).toBe(false);
  });
});

describe("fetchShopBrandLogo", () => {
  it("returns the primary brand logo", async () => {
    const url = await fetchShopBrandLogo(admin(brandPayload("https://cdn.shopify.com/logo.png")));
    expect(url).toBe("https://cdn.shopify.com/logo.png");
  });

  // A store that set only a square avatar still has a usable mark, and a square logo renders
  // fine at the small size an email header uses.
  it("falls back to the square logo when there is no primary", async () => {
    const url = await fetchShopBrandLogo(admin(brandPayload(null, "https://cdn.shopify.com/square.png")));
    expect(url).toBe("https://cdn.shopify.com/square.png");
  });

  it("falls back to the square logo when the primary is unusable", async () => {
    const url = await fetchShopBrandLogo(
      admin(brandPayload("javascript:alert(1)", "https://cdn.shopify.com/square.png")),
    );
    expect(url).toBe("https://cdn.shopify.com/square.png");
  });

  it("returns null when the shop has no brand logo at all", async () => {
    expect(await fetchShopBrandLogo(admin(brandPayload(null, null)))).toBeNull();
  });

  it("returns null on an empty or malformed response rather than throwing", async () => {
    expect(await fetchShopBrandLogo(admin({}))).toBeNull();
    expect(await fetchShopBrandLogo(admin({ data: { shop: null } }))).toBeNull();
    expect(await fetchShopBrandLogo(admin({ data: { shop: { brand: null } } }))).toBeNull();
  });
});

describe("ensureShopBrandLogo — caching", () => {
  it("uses the cached value without calling Shopify while fresh", async () => {
    const api = admin(brandPayload("https://cdn.shopify.com/new.png"));

    const url = await ensureShopBrandLogo(
      api,
      {
        id: "store_1",
        shopBrandLogoUrl: "https://cdn.shopify.com/cached.png",
        shopBrandLogoSyncedAt: new Date(NOW.getTime() - 1000),
      },
      NOW,
    );

    expect(url).toBe("https://cdn.shopify.com/cached.png");
    expect(setShopBrandLogo).not.toHaveBeenCalled();
  });

  it("re-syncs once the TTL has elapsed", async () => {
    const url = await ensureShopBrandLogo(
      admin(brandPayload("https://cdn.shopify.com/new.png")),
      {
        id: "store_1",
        shopBrandLogoUrl: "https://cdn.shopify.com/old.png",
        shopBrandLogoSyncedAt: new Date(NOW.getTime() - SHOP_BRAND_LOGO_TTL_MS - 1),
      },
      NOW,
    );

    expect(url).toBe("https://cdn.shopify.com/new.png");
    expect(setShopBrandLogo).toHaveBeenCalledWith("store_1", "https://cdn.shopify.com/new.png", NOW);
  });

  it("syncs on first ever load, when nothing has been cached", async () => {
    const url = await ensureShopBrandLogo(
      admin(brandPayload("https://cdn.shopify.com/logo.png")),
      { id: "store_1", shopBrandLogoUrl: null, shopBrandLogoSyncedAt: null },
      NOW,
    );

    expect(url).toBe("https://cdn.shopify.com/logo.png");
  });

  // A merchant who removed their Shopify logo must stop having the stale one rendered.
  it("persists null when the merchant removed their Shopify logo", async () => {
    const url = await ensureShopBrandLogo(
      admin(brandPayload(null)),
      {
        id: "store_1",
        shopBrandLogoUrl: "https://cdn.shopify.com/old.png",
        shopBrandLogoSyncedAt: new Date(NOW.getTime() - SHOP_BRAND_LOGO_TTL_MS - 1),
      },
      NOW,
    );

    expect(url).toBeNull();
    expect(setShopBrandLogo).toHaveBeenCalledWith("store_1", null, NOW);
  });

  it("discards a cached value that is no longer usable", async () => {
    const url = await ensureShopBrandLogo(
      admin(brandPayload("https://cdn.shopify.com/new.png")),
      {
        id: "store_1",
        shopBrandLogoUrl: "javascript:alert(1)",
        shopBrandLogoSyncedAt: new Date(NOW.getTime() - 1000),
      },
      NOW,
    );

    expect(url).toBeNull();
  });
});

describe("ensureShopBrandLogo — failure posture", () => {
  function failingAdmin() {
    return {
      graphql: vi.fn(async () => {
        throw new Error("Shopify is throttling");
      }),
    } as unknown as Parameters<typeof fetchShopBrandLogo>[0];
  }

  // The sync runs on every /app/* page load. A Shopify hiccup must never surface to the
  // merchant — an email with a text header beats an app that will not open.
  it("never throws, and degrades to the stored value", async () => {
    const url = await ensureShopBrandLogo(
      failingAdmin(),
      {
        id: "store_1",
        shopBrandLogoUrl: "https://cdn.shopify.com/cached.png",
        shopBrandLogoSyncedAt: new Date(NOW.getTime() - SHOP_BRAND_LOGO_TTL_MS - 1),
      },
      NOW,
    );

    expect(url).toBe("https://cdn.shopify.com/cached.png");
  });

  // Deliberately not persisted on failure, so the next load retries instead of waiting a day.
  it("does not persist anything on a transient failure", async () => {
    await ensureShopBrandLogo(
      failingAdmin(),
      { id: "store_1", shopBrandLogoUrl: null, shopBrandLogoSyncedAt: null },
      NOW,
    );

    expect(setShopBrandLogo).not.toHaveBeenCalled();
  });
});
