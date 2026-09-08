// Exercises googleReviewFeed.server.ts's real readiness-counting and XML-generation logic —
// no real database. No Shopify API call is involved in this file at all (unlike
// coupons/referrals), since the feed is generated purely from local Review/Product data.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeStore {
  id: string;
  domain: string | null;
  googleFeedEnabled: boolean;
  googleFeedToken: string | null;
}

interface FakeReview {
  id: string;
  storeId: string;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  createdAt: Date;
  deletedAt: Date | null;
  isPublished: boolean;
  product: { name: string; handle: string | null };
}

let stores: FakeStore[];
let reviews: FakeReview[];

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const store = stores.find((s) => s.id === where.id);
        if (!store) throw new Error("Store not found");
        return store;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeStore> }) => {
        const store = stores.find((s) => s.id === where.id);
        if (!store) throw new Error("Store not found");
        Object.assign(store, data);
        return store;
      }),
      findFirst: vi.fn(async ({ where }: { where: { googleFeedToken: string; googleFeedEnabled: boolean } }) => {
        return stores.find((s) => s.googleFeedToken === where.googleFeedToken && s.googleFeedEnabled === where.googleFeedEnabled) ?? null;
      }),
    },
    review: {
      findMany: vi.fn(async ({ where }: { where: { storeId: string; deletedAt: null; isPublished: boolean } }) =>
        reviews.filter((r) => r.storeId === where.storeId && r.deletedAt === null && r.isPublished === where.isPublished),
      ),
    },
  },
}));

const { getFeedReadiness, setGoogleFeedEnabled, generateFeedXml, findStoreByFeedToken } = await import("./googleReviewFeed.server");

beforeEach(() => {
  stores = [{ id: "store_1", domain: "example.myshopify.com", googleFeedEnabled: false, googleFeedToken: null }];
  reviews = [];
});

describe("getFeedReadiness", () => {
  it("counts a review as eligible only when it has real content and a real product handle", async () => {
    reviews.push(
      { id: "r1", storeId: "store_1", rating: 5, title: "Great", content: "Loved it", reviewerName: "A", createdAt: new Date(), deletedAt: null, isPublished: true, product: { name: "Mug", handle: "mug" } },
      { id: "r2", storeId: "store_1", rating: 4, title: null, content: "", reviewerName: "B", createdAt: new Date(), deletedAt: null, isPublished: true, product: { name: "Mug", handle: "mug" } },
      { id: "r3", storeId: "store_1", rating: 3, title: null, content: "Fine", reviewerName: "C", createdAt: new Date(), deletedAt: null, isPublished: true, product: { name: "Cup", handle: null } },
    );

    const readiness = await getFeedReadiness("store_1");
    expect(readiness.eligibleReviewCount).toBe(1);
    expect(readiness.excludedReviewCount).toBe(2);
    expect(readiness.excludedReasons.missingContent).toBe(1);
    expect(readiness.excludedReasons.noProductHandle).toBe(1);
  });

  it("reports the feed as disabled with no URL until turned on", async () => {
    const readiness = await getFeedReadiness("store_1");
    expect(readiness.feedEnabled).toBe(false);
    expect(readiness.feedUrl).toBeNull();
  });
});

describe("setGoogleFeedEnabled", () => {
  it("generates a token and enables the feed", async () => {
    const result = await setGoogleFeedEnabled("store_1", true);
    expect(result.feedUrl).toContain("/feeds/google-reviews/");
    expect(stores[0].googleFeedEnabled).toBe(true);
    expect(stores[0].googleFeedToken).toBeTruthy();
  });

  it("reuses the same token on a second enable rather than rotating it", async () => {
    await setGoogleFeedEnabled("store_1", true);
    const firstToken = stores[0].googleFeedToken;
    await setGoogleFeedEnabled("store_1", false);
    await setGoogleFeedEnabled("store_1", true);
    expect(stores[0].googleFeedToken).toBe(firstToken);
  });

  it("disables without clearing the token, so re-enabling keeps the same URL", async () => {
    await setGoogleFeedEnabled("store_1", true);
    const result = await setGoogleFeedEnabled("store_1", false);
    expect(result.feedUrl).toBeNull();
    expect(stores[0].googleFeedToken).toBeTruthy();
  });
});

describe("findStoreByFeedToken", () => {
  it("finds nothing for a disabled feed even with the right token", async () => {
    stores[0].googleFeedToken = "abc123";
    stores[0].googleFeedEnabled = false;
    const found = await findStoreByFeedToken("abc123");
    expect(found).toBeNull();
  });

  it("finds the store for an enabled feed's real token", async () => {
    stores[0].googleFeedToken = "abc123";
    stores[0].googleFeedEnabled = true;
    const found = await findStoreByFeedToken("abc123");
    expect(found?.id).toBe("store_1");
  });
});

describe("generateFeedXml", () => {
  it("includes only eligible reviews and escapes real special characters", async () => {
    reviews.push(
      { id: "r1", storeId: "store_1", rating: 5, title: "Love & trust", content: "Great <product>", reviewerName: "A&B", createdAt: new Date(), deletedAt: null, isPublished: true, product: { name: "Mug", handle: "mug" } },
      { id: "r2", storeId: "store_1", rating: 4, title: null, content: "", reviewerName: "C", createdAt: new Date(), deletedAt: null, isPublished: true, product: { name: "Cup", handle: "cup" } },
    );

    const xml = await generateFeedXml("store_1", "example.myshopify.com");
    expect(xml).toContain("<review_id>r1</review_id>");
    expect(xml).not.toContain("<review_id>r2</review_id>");
    expect(xml).toContain("Love &amp; trust");
    expect(xml).toContain("Great &lt;product&gt;");
    expect(xml).toContain("https://example.myshopify.com/products/mug");
  });
});
