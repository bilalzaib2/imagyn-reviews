// Exercises review.server.ts's getVideoReviews (the Video Reviews Carousel's data source)
// against a fake in-memory Prisma client — no real database.
//
// Its own file and its own fake, for the same reason review.server.featured.test.ts is
// separate: this needs a relation filter the other fakes don't model (`media: { some: { type
// } }`) plus `featured` ordering, and bolting that onto the security-critical mutation mock
// would make that file harder to reason about.
//
// The behaviour that matters here is what must NOT come back: unapproved reviews, deleted
// reviews, reviews with only photos, and — unlike the Review Carousel — any text-only
// backfill. A video carousel padded with text reviews is a bug, not a graceful fallback.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

interface FakeMedia {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

interface FakeReview {
  id: string;
  storeId: string;
  productId: string;
  reviewerName: string;
  verifiedPurchase: boolean;
  featured: boolean;
  rating: number;
  title: string | null;
  content: string;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  helpfulCount: number;
  media: FakeMedia[];
  product: { id: string; name: string; handle: string | null; featuredImage: string | null };
}

let reviews: FakeReview[];

function video(overrides: Partial<FakeMedia> = {}): FakeMedia {
  return {
    id: `media_${Math.random().toString(36).slice(2, 8)}`,
    type: "VIDEO",
    url: "https://cdn.shopify.com/videos/a.mp4",
    thumbnailUrl: "https://cdn.shopify.com/videos/a.jpg",
    width: 720,
    height: 1280,
    ...overrides,
  };
}

function photo(): FakeMedia {
  return { ...video(), type: "IMAGE", url: "https://cdn.shopify.com/files/a.jpg" };
}

function seed(overrides: Partial<FakeReview> & { id: string }): FakeReview {
  const review: FakeReview = {
    storeId: "store_1",
    productId: "product_1",
    reviewerName: "Jordan",
    verifiedPurchase: true,
    featured: false,
    rating: 5,
    title: "Great",
    content: "Loved it",
    status: ReviewStatus.APPROVED,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    helpfulCount: 0,
    media: [video()],
    product: { id: "product_1", name: "Creatine 300g", handle: "creatine-300g", featuredImage: null },
    ...overrides,
  };
  reviews.push(review);
  return review;
}

function matchesWhere(review: FakeReview, where: Record<string, unknown>): boolean {
  if (where.storeId !== undefined && review.storeId !== where.storeId) return false;
  if (where.deletedAt !== undefined && review.deletedAt !== where.deletedAt) return false;
  if (where.status !== undefined && review.status !== where.status) return false;

  // Mirrors Prisma's `media: { some: { type: VIDEO } }` — the actual selection criterion,
  // not just "has any media".
  const mediaFilter = where.media as { some?: { type?: string } } | undefined;
  if (mediaFilter?.some) {
    const wantedType = mediaFilter.some.type;
    const hasMatch = review.media.some((item) => (wantedType ? item.type === wantedType : true));
    if (!hasMatch) return false;
  }
  return true;
}

vi.mock("../db.server", () => ({
  default: {
    review: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: Record<string, unknown>;
          orderBy: Array<Record<string, "asc" | "desc">>;
          take: number;
        }) => {
          const matches = reviews.filter((review) => matchesWhere(review, where));

          matches.sort((a, b) => {
            for (const clause of orderBy) {
              if (clause.featured) {
                const diff = Number(a.featured) - Number(b.featured);
                if (diff !== 0) return clause.featured === "asc" ? diff : -diff;
              }
              if (clause.helpfulCount) {
                const diff = a.helpfulCount - b.helpfulCount;
                if (diff !== 0) return clause.helpfulCount === "asc" ? diff : -diff;
              }
              if (clause.createdAt) {
                const diff = a.createdAt.getTime() - b.createdAt.getTime();
                if (diff !== 0) return clause.createdAt === "asc" ? diff : -diff;
              }
              if (clause.id) {
                const diff = a.id.localeCompare(b.id);
                if (diff !== 0) return clause.id === "asc" ? diff : -diff;
              }
            }
            return 0;
          });

          return matches.slice(0, take);
        },
      ),
    },
  },
}));

vi.mock("./aiSummary.server", () => ({
  maybeAutoRegenerateAiSummary: vi.fn(),
  maybeAutoRegenerateStoreAiSummary: vi.fn(),
}));

vi.mock("./permissions", () => ({
  getStorePermissions: vi.fn(async () => ({})),
  PermissionError: class extends Error {},
}));

const { getVideoReviews } = await import("./review.server");

beforeEach(() => {
  reviews = [];
});

describe("getVideoReviews — what must not come back", () => {
  it("returns an approved review that has a video", async () => {
    seed({ id: "r1" });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["r1"]);
  });

  it("excludes reviews that are not approved", async () => {
    seed({ id: "approved" });
    seed({ id: "pending", status: ReviewStatus.PENDING });
    seed({ id: "rejected", status: ReviewStatus.REJECTED });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["approved"]);
  });

  it("excludes soft-deleted reviews", async () => {
    seed({ id: "live" });
    seed({ id: "deleted", deletedAt: new Date() });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["live"]);
  });

  it("excludes reviews with no media at all", async () => {
    seed({ id: "withVideo" });
    seed({ id: "textOnly", media: [] });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["withVideo"]);
  });

  it("excludes photo-only reviews — this widget is not a photo carousel", async () => {
    seed({ id: "withVideo" });
    seed({ id: "photoOnly", media: [photo()] });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["withVideo"]);
  });

  it("never backfills with text-only reviews when there are too few videos", async () => {
    seed({ id: "theOnlyVideo" });
    for (let i = 0; i < 10; i++) seed({ id: `text_${i}`, media: [] });

    const result = await getVideoReviews("store_1", 12);

    // A one-card carousel is the correct answer, not a padded twelve.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("theOnlyVideo");
  });

  it("scopes to the requested store", async () => {
    seed({ id: "mine" });
    seed({ id: "theirs", storeId: "store_2" });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["mine"]);
  });
});

describe("getVideoReviews — shape and ordering", () => {
  it("returns only the video media, dropping a review's photos", async () => {
    seed({ id: "mixed", media: [photo(), video({ id: "the_video" }), photo()] });
    const result = await getVideoReviews("store_1");

    expect(result[0].media).toHaveLength(1);
    expect(result[0].media[0].type).toBe("VIDEO");
    expect(result[0].media[0].id).toBe("the_video");
  });

  it("leads with merchant-featured reviews, then the most helpful", async () => {
    seed({ id: "helpful", helpfulCount: 50 });
    seed({ id: "featured", featured: true, helpfulCount: 0 });
    const result = await getVideoReviews("store_1");

    expect(result.map((review) => review.id)).toEqual(["featured", "helpful"]);
  });

  it("honours the limit", async () => {
    for (let i = 0; i < 8; i++) seed({ id: `r${i}` });
    const result = await getVideoReviews("store_1", 3);

    expect(result).toHaveLength(3);
  });

  it("carries the product context each card links to", async () => {
    seed({ id: "r1" });
    const result = await getVideoReviews("store_1");

    expect(result[0].product).toEqual({
      id: "product_1",
      name: "Creatine 300g",
      handle: "creatine-300g",
      featuredImage: null,
    });
  });

  it("preserves the real verified flag rather than assuming it", async () => {
    seed({ id: "unverified", verifiedPurchase: false });
    const result = await getVideoReviews("store_1");

    expect(result[0].verifiedPurchase).toBe(false);
  });
});
