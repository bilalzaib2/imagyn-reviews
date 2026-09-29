// The public discovery layer is the one unauthenticated, cross-store read surface in the app,
// so these tests are weighted toward the things that would be a data incident rather than a
// bug: publishing an unapproved review, leaking a merchant-private column, or letting a filter
// widen the approved-only scope.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    store: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    productAiSummary: { findUnique: vi.fn(async () => null) },
    storeAiSummary: { findUnique: vi.fn(async () => null) },
  },
}));

const {
  buildProductSlug, listPublicReviews, listReviewedProducts, listPublicStores,
  getPublicProduct, getPublicStore, getNetworkStats, searchPublic,
} = await import("./publicDiscovery.server");

beforeEach(() => {
  reviews = [];
  capturedWhere = null;
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
