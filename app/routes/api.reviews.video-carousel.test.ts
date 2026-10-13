// Exercises api.reviews.video-carousel.tsx's loader — the Video Reviews Carousel's data
// source, and the single enforcement point for the Pro entitlement.
//
// The entitlement tests here are the important ones. Hiding the widget card in the admin is
// cosmetic; if this loader ever serves video to an unentitled store, the feature is free in
// practice no matter what the dashboard shows. Equally, a downgrade must never be allowed to
// destroy a merchant's reviews or saved block settings — it may only stop serving them.
import { beforeEach, describe, expect, it, vi } from "vitest";

let permissions: { canUseVideoReviewsCarousel: boolean };
let storeRecord: { id: string } | null;
let videoReviews: Array<Record<string, unknown>>;

vi.mock("../shopify.server", () => ({
  authenticate: {
    public: {
      appProxy: vi.fn(async () => ({ admin: {} })),
    },
  },
}));

vi.mock("../services/store.server", () => ({
  getStoreBySlug: vi.fn(async () => storeRecord),
}));

const getVideoReviewsMock = vi.fn(async () => videoReviews);
vi.mock("../services/review.server", () => ({
  getVideoReviews: (...args: unknown[]) => getVideoReviewsMock(...(args as [])),
  getPublicReviewSummaryBatch: vi.fn(async () => ({ product_1: { averageRating: 4.8, totalReviews: 9 } })),
}));

const getStorefrontAppearanceMock = vi.fn(async () => ({ colors: {} }));
vi.mock("../services/appearance.server", () => ({
  getStorefrontAppearance: (...args: unknown[]) => getStorefrontAppearanceMock(...(args as [])),
}));

vi.mock("../services/permissions", () => ({
  getStorePermissions: vi.fn(async () => permissions),
}));

const { loader } = await import("./api.reviews.video-carousel");

function requestFor(params: Record<string, string> = {}) {
  const search = new URLSearchParams({ shop: "verve.myshopify.com", ...params }).toString();
  return new Request(`https://example.com/apps/reviews/video-carousel?${search}`);
}

function videoReview(overrides: Record<string, unknown> = {}) {
  return {
    id: "review_1",
    reviewerName: "Jordan A.",
    verifiedPurchase: true,
    rating: 5,
    title: "Great",
    content: "Works exactly as shown.",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    product: { id: "product_1", name: "Creatine 300g", handle: "creatine-300g", featuredImage: "https://cdn.example.com/p.jpg" },
    media: [
      {
        id: "media_1",
        type: "VIDEO",
        url: "https://cdn.shopify.com/videos/a.mp4",
        thumbnailUrl: "https://cdn.shopify.com/videos/a.jpg",
        width: 720,
        height: 1280,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  permissions = { canUseVideoReviewsCarousel: true };
  storeRecord = { id: "store_1" };
  videoReviews = [videoReview()];
  getVideoReviewsMock.mockClear();
  getStorefrontAppearanceMock.mockClear();
});

describe("Pro entitlement", () => {
  it("serves video reviews to an entitled store", async () => {
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.ok).toBe(true);
    expect(body.locked).toBe(false);
    expect(body.reviews).toHaveLength(1);
  });

  it("serves nothing to a store without the entitlement", async () => {
    permissions = { canUseVideoReviewsCarousel: false };
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.locked).toBe(true);
    expect(body.reviews).toEqual([]);
  });

  it("does not even query for reviews when the store isn't entitled", async () => {
    // Not just filtered out after the fact — an unentitled store's video reviews are never
    // read, so they cannot leak through a serialization bug either.
    permissions = { canUseVideoReviewsCarousel: false };
    await loader({ request: requestFor() } as never);

    expect(getVideoReviewsMock).not.toHaveBeenCalled();
  });

  it("cannot be unlocked by anything in the request — entitlement comes from billing only", async () => {
    permissions = { canUseVideoReviewsCarousel: false };
    // Every shape a tampered storefront/theme could plausibly try.
    const body = await (
      await loader({
        request: requestFor({ plan: "growth", pro: "true", canUseVideoReviewsCarousel: "true", locked: "false" }),
      } as never)
    ).json();

    expect(body.locked).toBe(true);
    expect(body.reviews).toEqual([]);
  });

  it("returns 200, not an error, when locked — a downgraded storefront goes quiet, not broken", async () => {
    permissions = { canUseVideoReviewsCarousel: false };
    const response = await loader({ request: requestFor() } as never);

    expect(response.status).toBe(200);
  });

  it("restores immediately on re-upgrade, with no stored state to repair", async () => {
    // Downgrade.
    permissions = { canUseVideoReviewsCarousel: false };
    expect((await (await loader({ request: requestFor() } as never)).json()).reviews).toEqual([]);

    // Re-upgrade. Nothing was deleted on the way down, so the same reviews come straight back.
    permissions = { canUseVideoReviewsCarousel: true };
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.locked).toBe(false);
    expect(body.reviews).toHaveLength(1);
  });
});

describe("media integrity", () => {
  it("drops a review whose video URL isn't loadable rather than shipping a dead player", async () => {
    videoReviews = [
      videoReview({ id: "bad", media: [{ id: "m", type: "VIDEO", url: "javascript:alert(1)", thumbnailUrl: null, width: null, height: null }] }),
      videoReview({ id: "good" }),
    ];
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].id).toBe("good");
  });

  it("drops an unsafe poster but keeps the playable video", async () => {
    videoReviews = [
      videoReview({
        media: [
          {
            id: "m",
            type: "VIDEO",
            url: "https://cdn.shopify.com/videos/a.mp4",
            thumbnailUrl: "javascript:alert(1)",
            width: null,
            height: null,
          },
        ],
      }),
    ];
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].media[0].thumbnailUrl).toBeNull();
    expect(body.reviews[0].media[0].url).toBe("https://cdn.shopify.com/videos/a.mp4");
  });

  it("tolerates a malformed URL without throwing", async () => {
    videoReviews = [videoReview({ media: [{ id: "m", type: "VIDEO", url: "not a url", thumbnailUrl: null, width: null, height: null }] })];
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.ok).toBe(true);
    expect(body.reviews).toEqual([]);
  });
});

describe("privacy and payload shape", () => {
  it("never exposes merchant-private or reviewer-private fields", async () => {
    videoReviews = [
      videoReview({
        reviewerEmail: "shopper@example.com",
        reviewerLocation: "Lahore",
        status: "APPROVED",
        internalNote: "flagged by rule",
      }),
    ];
    const body = await (await loader({ request: requestFor() } as never)).json();
    const keys = Object.keys(body.reviews[0]);

    expect(keys).not.toContain("reviewerEmail");
    expect(keys).not.toContain("reviewerLocation");
    expect(keys).not.toContain("internalNote");
    expect(keys).not.toContain("status");
  });

  it("passes the verified flag through truthfully rather than assuming it", async () => {
    videoReviews = [videoReview({ verifiedPurchase: false })];
    const body = await (await loader({ request: requestFor() } as never)).json();

    expect(body.reviews[0].verifiedPurchase).toBe(false);
  });

  it("resolves its own Brand Studio surface, not the Review Carousel's", async () => {
    await loader({ request: requestFor() } as never);

    expect(getStorefrontAppearanceMock).toHaveBeenCalledWith("store_1", "video_reviews_carousel");
  });
});

describe("request handling", () => {
  it("400s without a shop", async () => {
    const response = await loader({ request: new Request("https://example.com/apps/reviews/video-carousel") } as never);
    expect(response.status).toBe(400);
  });

  it("404s for an unknown shop", async () => {
    storeRecord = null;
    const response = await loader({ request: requestFor() } as never);
    expect(response.status).toBe(404);
  });

  it("clamps an oversized limit instead of letting a caller request the whole table", async () => {
    await loader({ request: requestFor({ limit: "5000" }) } as never);
    expect(getVideoReviewsMock).toHaveBeenCalledWith("store_1", 24);
  });

  it("falls back to the default limit for a nonsense value", async () => {
    await loader({ request: requestFor({ limit: "abc" }) } as never);
    expect(getVideoReviewsMock).toHaveBeenCalledWith("store_1", 12);
  });
});
