// Exercises review.server.ts's getFeaturedReviews (the Review Carousel's data source)
// against a fake in-memory Prisma client — no real database. Separate mock/file from
// review.server.test.ts (which is scoped to the mutation/IDOR suite) since this needs a
// richer fake schema (joined product + media) that would otherwise complicate that file's
// existing, security-critical mock.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";

interface FakeProduct {
  id: string;
  storeId: string;
  name: string;
  handle: string | null;
  featuredImage: string | null;
}

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
}

let reviews: FakeReview[];
let products: FakeProduct[];

function seedProduct(overrides: Partial<FakeProduct> & { id: string; storeId: string }): FakeProduct {
  const product: FakeProduct = { name: "Test Product", handle: "test-product", featuredImage: null, ...overrides };
  products.push(product);
  return product;
}

function seedReview(overrides: Partial<FakeReview> & { id: string; storeId: string; productId: string }): FakeReview {
  const review: FakeReview = {
    reviewerName: "Jordan",
    verifiedPurchase: true,
    featured: false,
    rating: 5,
    title: "Great",
    content: "Loved it",
    status: ReviewStatus.APPROVED,
    deletedAt: null,
    createdAt: new Date(),
    helpfulCount: 0,
    media: [],
    ...overrides,
  };
  reviews.push(review);
  return review;
}

function matchesWhere(review: FakeReview, where: Record<string, unknown>): boolean {
  if (where.storeId !== undefined && review.storeId !== where.storeId) return false;
  if (where.deletedAt !== undefined && review.deletedAt !== where.deletedAt) return false;
  if (where.status !== undefined && review.status !== where.status) return false;
  if (where.featured !== undefined && review.featured !== where.featured) return false;
  if (where.id && typeof where.id === "object" && "notIn" in (where.id as object)) {
    const notIn = (where.id as { notIn: string[] }).notIn;
    if (notIn.includes(review.id)) return false;
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
              if (clause.createdAt) {
                const diff = a.createdAt.getTime() - b.createdAt.getTime();
                if (diff !== 0) return clause.createdAt === "asc" ? diff : -diff;
              }
              if (clause.helpfulCount) {
                const diff = a.helpfulCount - b.helpfulCount;
                if (diff !== 0) return clause.helpfulCount === "asc" ? diff : -diff;
              }
              if (clause.id) {
                const diff = a.id.localeCompare(b.id);
                if (diff !== 0) return clause.id === "asc" ? diff : -diff;
              }
            }
            return 0;
          });

          const page = matches.slice(0, take);

          return page.map((review) => {
            const product = products.find((p) => p.id === review.productId);
            return {
              ...review,
              product: product
                ? { id: product.id, name: product.name, handle: product.handle, featuredImage: product.featuredImage }
                : null,
            };
          });
        },
      ),
    },
  },
}));

const { getFeaturedReviews } = await import("./review.server");

beforeEach(() => {
  reviews = [];
  products = [];
  seedProduct({ id: "product_1", storeId: "store_1" });
  seedProduct({ id: "product_2", storeId: "store_2" });
});

describe("getFeaturedReviews — tenant isolation", () => {
  it("never returns another store's reviews", async () => {
    seedReview({ id: "review_1", storeId: "store_1", productId: "product_1", featured: true });
    seedReview({ id: "review_2", storeId: "store_2", productId: "product_2", featured: true });

    const results = await getFeaturedReviews("store_1");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("review_1");
  });
});

describe("getFeaturedReviews — real, non-fabricated data only", () => {
  it("only returns approved, non-deleted reviews", async () => {
    seedReview({ id: "review_pending", storeId: "store_1", productId: "product_1", status: ReviewStatus.PENDING });
    seedReview({ id: "review_deleted", storeId: "store_1", productId: "product_1", deletedAt: new Date() });
    seedReview({ id: "review_ok", storeId: "store_1", productId: "product_1" });

    const results = await getFeaturedReviews("store_1");

    expect(results.map((r) => r.id)).toEqual(["review_ok"]);
  });

  it("returns an empty array (not fabricated placeholder data) when a store has no reviews", async () => {
    const results = await getFeaturedReviews("store_1");
    expect(results).toEqual([]);
  });

  it("includes real product and media info on each review", async () => {
    seedProduct({ id: "product_3", storeId: "store_1", name: "Ceramic Bowl", handle: "ceramic-bowl", featuredImage: "https://example.com/bowl.jpg" });
    seedReview({
      id: "review_1",
      storeId: "store_1",
      productId: "product_3",
      media: [{ id: "media_1", type: "IMAGE", url: "https://example.com/photo.jpg", thumbnailUrl: null, width: 800, height: 600 }],
    });

    const [result] = await getFeaturedReviews("store_1");

    expect(result.product).toEqual({
      id: "product_3",
      name: "Ceramic Bowl",
      handle: "ceramic-bowl",
      featuredImage: "https://example.com/bowl.jpg",
    });
    expect(result.media).toHaveLength(1);
    expect(result.media[0].url).toBe("https://example.com/photo.jpg");
  });
});

describe("getFeaturedReviews — featured-first ordering with real-data backfill", () => {
  it("prioritizes merchant-curated featured reviews over non-featured ones", async () => {
    seedReview({ id: "not_featured", storeId: "store_1", productId: "product_1", featured: false, createdAt: new Date(2026, 0, 5) });
    seedReview({ id: "featured_1", storeId: "store_1", productId: "product_1", featured: true, createdAt: new Date(2026, 0, 1) });

    const results = await getFeaturedReviews("store_1", 12);

    expect(results[0].id).toBe("featured_1");
  });

  it("backfills with real reviews (highest helpful first) when featured reviews don't fill the limit", async () => {
    seedReview({ id: "featured_1", storeId: "store_1", productId: "product_1", featured: true });
    seedReview({ id: "backfill_low", storeId: "store_1", productId: "product_1", featured: false, helpfulCount: 1 });
    seedReview({ id: "backfill_high", storeId: "store_1", productId: "product_1", featured: false, helpfulCount: 10 });

    const results = await getFeaturedReviews("store_1", 3);

    expect(results.map((r) => r.id)).toEqual(["featured_1", "backfill_high", "backfill_low"]);
  });

  it("never duplicates a review between the featured and backfill batches", async () => {
    seedReview({ id: "review_1", storeId: "store_1", productId: "product_1", featured: true });

    const results = await getFeaturedReviews("store_1", 5);

    expect(results.map((r) => r.id)).toEqual(["review_1"]);
  });

  it("respects the requested limit", async () => {
    for (let i = 0; i < 5; i++) {
      seedReview({ id: `review_${i}`, storeId: "store_1", productId: "product_1", featured: true });
    }

    const results = await getFeaturedReviews("store_1", 2);
    expect(results).toHaveLength(2);
  });
});
