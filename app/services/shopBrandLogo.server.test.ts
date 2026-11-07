// Shopify brand-logo sync.
//
// Two things matter here and both are security- or correctness-shaped rather than cosmetic:
//
//  1. The URL ends up inside an email `<img src>`, so validation happens at that boundary even
//     though Shopify is a trusted source. "Trusted" is not "skip validation".
//  2. A Shopify API failure must degrade to the stored value and never break a page load — the
//     sync is fire-and-forget from app.tsx's loader, which every /app/* screen goes through.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setShopBrandLogo = vi.fn(async (id: string, url: string | null, syncedAt: Date) => ({ id, url, syncedAt }));

vi.mock("./store.server", () => ({
  setShopBrandLogo: (id: string, url: string | null, syncedAt: Date) => setShopBrandLogo(id, url, syncedAt),
}));

const {
  ensureShopBrandLogo,
  fetchShopBrandLogo,
  isUsableLogoUrl,
  SHOP_BRAND_LOGO_AVAILABLE,
  SHOP_BRAND_LOGO_TTL_MS,
} = await import("./shopBrandLogo.server");

function admin(payload: unknown) {
  return {
    graphql: vi.fn(async () => ({ json: async () => payload })),
  } as unknown as Parameters<typeof fetchShopBrandLogo>[0];
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

// VERIFIED 2026-11-08: the Admin GraphQL API's Shop object has no `brand` field. It exists on
// the STOREFRONT API only. Both halves of the Admin field list were read and `brand` is absent;
// the Storefront Shop page lists it as "The shop's branding configuration".
//
// So this module can no longer parse a brand response, because one can never arrive. What used
// to be tested here — primary logo, square-logo fallback, malformed payloads — was a parser for
// a reply Shopify has no field to produce. Those tests passed for three days against a mocked
// response while the real call returned an error every time, for every merchant.
//
// What is pinned now is the honest contract, plus the thing that actually matters: the logo
// chain still ends somewhere sensible.
describe("the Shopify brand logo source is unavailable, and says so", () => {
  it("reports itself unavailable", () => {
    expect(SHOP_BRAND_LOGO_AVAILABLE).toBe(false);
  });

  it("returns null without asking Shopify anything", async () => {
    const api = admin({ data: { shop: { brand: { logo: { image: { url: "https://cdn.shopify.com/x.png" } } } } } });

    expect(await fetchShopBrandLogo(api)).toBeNull();
    // The point of the change: no doomed round trip on every app load.
    expect((api as unknown as { graphql: { mock: { calls: unknown[] } } }).graphql.mock.calls).toHaveLength(0);
  });

  it("sends no query, so there is no non-existent field left to request", () => {
    // Comments are stripped first: the module's own note quotes the dead query at length to
    // explain why it is gone, and that explanation is the opposite of a breach.
    const code = readFileSync("app/services/shopBrandLogo.server.ts", "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");

    expect(code).not.toMatch(/#graphql/);
    expect(code).not.toMatch(/brand\s*\{/);
  });
});

describe("ensureShopBrandLogo while the source is unavailable", () => {
  it("does no network call and no write", async () => {
    const api = admin({});
    const result = await ensureShopBrandLogo(api, {
      id: "store_1",
      shopBrandLogoUrl: null,
      shopBrandLogoSyncedAt: null,
    });

    expect(result).toBeNull();
    expect((api as unknown as { graphql: { mock: { calls: unknown[] } } }).graphql.mock.calls).toHaveLength(0);
  });

  it("still returns a logo a previous version cached", async () => {
    // Removing the broken fetch must not throw away a value already in the column.
    const result = await ensureShopBrandLogo(admin({}), {
      id: "store_1",
      shopBrandLogoUrl: "https://cdn.shopify.com/cached.png",
      shopBrandLogoSyncedAt: new Date("2026-11-05T00:00:00Z"),
    });

    expect(result).toBe("https://cdn.shopify.com/cached.png");
  });

  it("ignores a cached value that is not a usable image src", async () => {
    const result = await ensureShopBrandLogo(admin({}), {
      id: "store_1",
      shopBrandLogoUrl: "javascript:alert(1)",
      shopBrandLogoSyncedAt: new Date("2026-11-05T00:00:00Z"),
    });

    expect(result).toBeNull();
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

// Whether the Admin API exposes shop.brand at all is unverified against a live shop as of
// 2026-11-08 — the documentation places Brand on the STOREFRONT API. If it is absent here,
// every call returns null, which looks exactly like a merchant who never set a logo, and the
// feature would appear to work while doing nothing forever.
//
// These pin the distinction so the first real install answers the question in one grep.
