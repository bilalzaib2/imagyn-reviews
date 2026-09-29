// The public discovery layer is the one unauthenticated, cross-store read surface in the app,
// so these tests are weighted toward the things that would be a data incident rather than a
// bug: publishing an unapproved review, leaking a merchant-private column, or letting a filter
// widen the approved-only scope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeReview {
  id: string;
  storeId: string;
  productId: string;
  status: string;
  deletedAt: Date | null;
  rating: number;
  verifiedPurchase: boolean;
}

let reviews: FakeReview[];
let capturedWhere: Record<string, unknown> | null;

// Captures the `where` every query builds so the approved-only invariant can be asserted
// directly, rather than inferred from which rows a fake table happens to return.
vi.mock("../db.server", () => ({
  default: {
    review: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return reviews.length;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return [];
      }),
      groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return [];
      }),
    },
    product: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    store: {
      findUnique: vi.fn(async () => null),
      // getPublicStore moved to findFirst so the development-store exclusion can sit in the
      // same lookup that resolves the slug.
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        capturedWhere = where;
        return null;
      }),
      findMany: vi.fn(async () => []),
    },
    productAiSummary: { findUnique: vi.fn(async () => null) },
    storeAiSummary: { findUnique: vi.fn(async () => null) },
  },
}));

const prismaMock = (await import("../db.server")).default as unknown as {
  store: { findFirst: ReturnType<typeof vi.fn> };
  review: { groupBy: ReturnType<typeof vi.fn> };
};

const {
  buildProductSlug, listPublicReviews, listReviewedProducts, listPublicStores,
  getPublicProduct, getPublicStore, getNetworkStats, searchPublic,
} = await import("./publicDiscovery.server");

beforeEach(() => {
  reviews = [];
  capturedWhere = null;
});

// Two independent conditions gate the public network, and both are enforced in the database
// query rather than in any UI:
//
//   isDevelopmentStore: false  — development and test stores (Verveonline, and every Shopify
//     App Review install) must never reach the public consumer network. Keyed on the flag the
//     app already sets from Shopify's own partnerDevelopment signal, so these assert the
//     filter is present on every path rather than testing one store's name.
//   publicNetworkEnabled: true — the merchant's own participation control.
//
// These assert the whole `store` filter object by equality on purpose. A looser assertion
// (toMatchObject, or checking one key) would still pass if a future edit dropped the other
// condition, which is the exact regression that would silently publish a store that opted
// out — or a development store.
describe("development stores are excluded from every public path", () => {
  const devExcluded = { isDevelopmentStore: false, publicNetworkEnabled: true };

  it("the base review filter excludes development stores", async () => {
    await listPublicReviews();
    expect(capturedWhere!.store).toEqual(devExcluded);
  });

  it("a caller-supplied store filter cannot drop the exclusion", async () => {
    // The bug this guards against: assigning where.store = { slug } outright would replace
    // the exclusion, letting ?store=verveonline publish a dev store's reviews.
    await listPublicReviews({ store: "verveonline" });
    expect(capturedWhere!.store).toEqual({ isDevelopmentStore: false, publicNetworkEnabled: true, slug: "verveonline" });
  });

  it("every filter combination keeps the exclusion", async () => {
    await listPublicReviews({ verifiedOnly: true, withPhotos: true, rating: 5, category: "Pottery", sort: "helpful" });
    expect(capturedWhere!.store).toEqual(devExcluded);
  });

  it("network stats, facets, product and store listings all exclude them", async () => {
    await getNetworkStats();
    expect(capturedWhere!.store).toEqual(devExcluded);
    await listReviewedProducts();
    expect(capturedWhere!.store).toEqual(devExcluded);
    await listPublicStores();
    expect(capturedWhere!.store).toEqual(devExcluded);
  });

  it("a development store's own store page resolves to null", async () => {
    await expect(getPublicStore("verveonline")).resolves.toBeNull();
  });

  it("a development store's product page resolves to null", async () => {
    await expect(getPublicProduct("anything--abc123")).resolves.toBeNull();
  });

  it("search never returns development-store content", async () => {
    const result = await searchPublic("verve");
    expect(result.products).toEqual([]);
    expect(result.stores).toEqual([]);
    expect(result.reviews).toEqual([]);
    expect(capturedWhere!.store).toMatchObject(devExcluded);
  });
});

// The merchant-facing participation control (Store.publicNetworkEnabled, surfaced in
// Settings > Growth > Google, SEO & AI). A merchant who switches it off must disappear from
// every public surface at the database level — not be hidden by a consumer-side filter that
// a future page, feed or sitemap could forget to apply.
//
// These assert the filter on each entry point separately rather than trusting that they all
// share PUBLIC_STORE, because the thing worth protecting is the guarantee, not the current
// implementation detail that happens to provide it.
describe("merchant public-network participation is enforced server-side", () => {
  const participating = { isDevelopmentStore: false, publicNetworkEnabled: true };

  it("the base review feed only reads participating stores", async () => {
    await listPublicReviews();
    expect(capturedWhere!.store).toEqual(participating);
  });

  it("a store filter cannot resurrect a store that opted out", async () => {
    // Same class of bug as the development-store case: replacing where.store outright would
    // drop publicNetworkEnabled, so ?store=<slug> could publish an opted-out store.
    await listPublicReviews({ store: "opted-out-store" });
    expect(capturedWhere!.store).toEqual({ ...participating, slug: "opted-out-store" });
  });

  it("no filter combination drops the participation condition", async () => {
    await listPublicReviews({ verifiedOnly: true, withPhotos: true, rating: 5, category: "Pottery", sort: "helpful" });
    expect(capturedWhere!.store).toEqual(participating);
  });

  it("counts, facets, product listings and store listings all require participation", async () => {
    await getNetworkStats();
    expect(capturedWhere!.store).toEqual(participating);
    await listReviewedProducts();
    expect(capturedWhere!.store).toEqual(participating);
    await listPublicStores();
    expect(capturedWhere!.store).toEqual(participating);
  });

  it("an opted-out store's own store page resolves to null", async () => {
    await expect(getPublicStore("opted-out-store")).resolves.toBeNull();
  });

  it("an opted-out store's product page resolves to null", async () => {
    await expect(getPublicProduct("anything--abc123")).resolves.toBeNull();
  });

  it("search never returns content from a store that opted out", async () => {
    const result = await searchPublic("opted-out");
    expect(result.products).toEqual([]);
    expect(result.stores).toEqual([]);
    expect(result.reviews).toEqual([]);
    expect(capturedWhere!.store).toMatchObject(participating);
  });

  it("participation and the development-store exclusion are independent conditions", async () => {
    // Enabling participation must never be able to publish a development store, so both keys
    // have to survive together on the same filter.
    await listPublicReviews();
    expect(capturedWhere!.store).toHaveProperty("isDevelopmentStore", false);
    expect(capturedWhere!.store).toHaveProperty("publicNetworkEnabled", true);
  });
});

// The tests above assert the filter this service builds. This one proves the filter actually
// selects the right rows, by giving store.findFirst a fake that really applies the where
// clause to a small fixture table — so a store that opted out disappears and a participating
// store is still returned, rather than both outcomes resting on the same captured object.
describe("participation decides which store rows are returned", () => {
  const STORES = [
    { id: "s1", name: "Participating Store", slug: "participating", isDevelopmentStore: false, publicNetworkEnabled: true },
    { id: "s2", name: "Opted Out Store", slug: "opted-out", isDevelopmentStore: false, publicNetworkEnabled: false },
    { id: "s3", name: "Dev Store", slug: "verveonline", isDevelopmentStore: true, publicNetworkEnabled: true },
  ];

  beforeEach(() => {
    // getPublicStore also requires at least one approved review before a store is
    // discoverable (an existing product rule, covered by its own test above), so give every
    // fixture store one — otherwise this describe would pass for the wrong reason.
    prismaMock.review.groupBy.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      capturedWhere = where;
      return [{ rating: 5, _count: { _all: 3 } }];
    });

    prismaMock.store.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      capturedWhere = where;
      const match = STORES.find(
        (store) =>
          store.slug === where.slug &&
          (where.isDevelopmentStore === undefined || store.isDevelopmentStore === where.isDevelopmentStore) &&
          (where.publicNetworkEnabled === undefined || store.publicNetworkEnabled === where.publicNetworkEnabled),
      );
      return match ?? null;
    });
  });

  it("a participating store is still found", async () => {
    await expect(getPublicStore("participating")).resolves.not.toBeNull();
  });

  it("a store that opted out is not found, even though the row still exists", async () => {
    await expect(getPublicStore("opted-out")).resolves.toBeNull();
  });

  it("a development store is not found regardless of its participation flag", async () => {
    await expect(getPublicStore("verveonline")).resolves.toBeNull();
  });

  // These two mocks are overridden for this describe only. Without restoring them, the
  // filtering fake and the non-empty groupBy would leak into every describe declared after
  // this one and could make an unrelated test pass for the wrong reason.
  afterEach(() => {
    prismaMock.store.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      capturedWhere = where;
      return null;
    });
    prismaMock.review.groupBy.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      capturedWhere = where;
      return [];
    });
  });
});

describe("approved-only invariant", () => {
  it("every review query filters to APPROVED and not-deleted", async () => {
    await listPublicReviews();
    expect(capturedWhere).toMatchObject({ status: "APPROVED", deletedAt: null });
  });

  it("no filter combination can widen past APPROVED", async () => {
    await listPublicReviews({
      verifiedOnly: true, withPhotos: true, rating: 5,
      category: "Pottery", store: "some-store", sort: "highest",
    });
    expect(capturedWhere).toMatchObject({ status: "APPROVED", deletedAt: null });
  });

  it("network stats count only approved content", async () => {
    await getNetworkStats();
    expect(capturedWhere).toMatchObject({ status: "APPROVED", deletedAt: null });
  });

  it("product and store listings are built from approved reviews", async () => {
    await listReviewedProducts();
    expect(capturedWhere).toMatchObject({ status: "APPROVED", deletedAt: null });
    await listPublicStores();
    expect(capturedWhere).toMatchObject({ status: "APPROVED", deletedAt: null });
  });
});

describe("filters translate to the right query", () => {
  it("verified maps to IMAGYN's own verifiedPurchase flag", async () => {
    await listPublicReviews({ verifiedOnly: true });
    expect(capturedWhere).toMatchObject({ verifiedPurchase: true });
  });

  it("photo and video filters target the media type enum, not a lowercase string", async () => {
    await listPublicReviews({ withPhotos: true });
    expect(capturedWhere!.media).toEqual({ some: { type: "IMAGE" } });
    await listPublicReviews({ withVideo: true });
    expect(capturedWhere!.media).toEqual({ some: { type: "VIDEO" } });
  });

  it("ignores an out-of-range rating rather than querying for it", async () => {
    await listPublicReviews({ rating: 9 });
    expect(capturedWhere).not.toHaveProperty("rating");
    await listPublicReviews({ rating: 0 });
    expect(capturedWhere).not.toHaveProperty("rating");
  });

  it("an unresolvable product slug matches nothing instead of every product", async () => {
    await listPublicReviews({ product: "totally-bogus" });
    expect(capturedWhere!.product).toEqual({ id: "__no_such_product__" });
  });
});

describe("public product slugs", () => {
  const product = { id: "clxyz000111pcegh8", handle: "summit-insulated-bottle", slug: null, name: "Summit Bottle" };

  it("is readable and carries a uniqueness suffix", () => {
    expect(buildProductSlug(product)).toBe("summit-insulated-bottle--pcegh8");
  });

  it("falls back through slug then name when there is no handle", () => {
    expect(buildProductSlug({ ...product, handle: null, slug: "fallback-slug" })).toBe("fallback-slug--pcegh8");
    expect(buildProductSlug({ ...product, handle: null, slug: null })).toBe("summit-bottle--pcegh8");
  });

  it("never emits an empty or unsafe slug", () => {
    const slug = buildProductSlug({ ...product, handle: "!!!", slug: null, name: "!!!" });
    expect(slug).toBe("product--pcegh8");
    expect(slug).toMatch(/^[a-z0-9-]+--[a-z0-9]{6}$/);
  });

  it("returns null for a slug with no valid suffix", async () => {
    await expect(getPublicProduct("no-suffix-here")).resolves.toBeNull();
  });
});

describe("stores and products with no approved reviews are not discoverable", () => {
  it("a store with zero approved reviews resolves to null, not an empty page", async () => {
    // This is what keeps the Shopify App Review test installs out of consumer discovery.
    await expect(getPublicStore("app-review-test-install")).resolves.toBeNull();
  });

  it("listings return an empty array when nothing qualifies", async () => {
    await expect(listReviewedProducts()).resolves.toEqual([]);
    await expect(listPublicStores()).resolves.toEqual([]);
  });
});

describe("search", () => {
  it("ignores queries too short to be meaningful, without touching the database", async () => {
    const result = await searchPublic("a");
    expect(result).toEqual({ products: [], stores: [], reviews: [] });
    expect(capturedWhere).toBeNull();
  });
});
