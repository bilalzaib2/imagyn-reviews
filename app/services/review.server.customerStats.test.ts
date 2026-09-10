// Exercises getCustomerReviewStatsByEmail (backs the Customer Detail Admin Block extension)
// against a fake in-memory Prisma client — no real database. Separate mock/file from
// review.server.test.ts (the mutation/IDOR suite), same reasoning as
// review.server.featured.test.ts's own header comment.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeReview {
  storeId: string;
  reviewerEmail: string | null;
  rating: number;
  title: string | null;
  productTitle: string | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
}

let reviews: FakeReview[];

function matches(review: FakeReview, storeId: string, email: string): boolean {
  return (
    review.storeId === storeId &&
    review.deletedAt === null &&
    review.reviewerEmail !== null &&
    review.reviewerEmail.toLowerCase() === email.toLowerCase()
  );
}

vi.mock("../db.server", () => ({
  default: {
    review: {
      count: vi.fn(async ({ where }: { where: { storeId: string; reviewerEmail: { equals: string } } }) =>
        reviews.filter((r) => matches(r, where.storeId, where.reviewerEmail.equals)).length,
      ),
      aggregate: vi.fn(async ({ where }: { where: { storeId: string; reviewerEmail: { equals: string } } }) => {
        const matched = reviews.filter((r) => matches(r, where.storeId, where.reviewerEmail.equals));
        if (matched.length === 0) return { _avg: { rating: null } };
        return { _avg: { rating: matched.reduce((sum, r) => sum + r.rating, 0) / matched.length } };
      }),
      findFirst: vi.fn(async ({ where }: { where: { storeId: string; reviewerEmail: { equals: string } } }) => {
        const matched = reviews
          .filter((r) => matches(r, where.storeId, where.reviewerEmail.equals))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matched[0] ?? null;
      }),
    },
  },
}));

const { getCustomerReviewStatsByEmail } = await import("./review.server");

beforeEach(() => {
  reviews = [];
});

describe("getCustomerReviewStatsByEmail", () => {
  it("returns zero/null stats when the customer has no reviews at this store", async () => {
    const result = await getCustomerReviewStatsByEmail("store_1", "nobody@example.com");
    expect(result).toEqual({ reviewCount: 0, averageRating: null, mostRecent: null });
  });

  it("matches case-insensitively — a reviewer-typed address doesn't have to match Shopify's stored casing", async () => {
    reviews.push({
      storeId: "store_1",
      reviewerEmail: "Jordan@Example.com",
      rating: 5,
      title: "Great",
      productTitle: "Blue Shirt",
      status: "APPROVED",
      deletedAt: null,
      createdAt: new Date(),
    });

    const result = await getCustomerReviewStatsByEmail("store_1", "jordan@example.com");
    expect(result.reviewCount).toBe(1);
  });

  it("computes the real average across every non-deleted review and surfaces the most recent one", async () => {
    reviews.push(
      {
        storeId: "store_1",
        reviewerEmail: "jordan@example.com",
        rating: 4,
        title: "Good",
        productTitle: "Blue Shirt",
        status: "APPROVED",
        deletedAt: null,
        createdAt: new Date("2026-01-01"),
      },
      {
        storeId: "store_1",
        reviewerEmail: "jordan@example.com",
        rating: 2,
        title: "Meh, second time",
        productTitle: "Red Hat",
        status: "PENDING",
        deletedAt: null,
        createdAt: new Date("2026-06-01"),
      },
    );

    const result = await getCustomerReviewStatsByEmail("store_1", "jordan@example.com");
    expect(result.reviewCount).toBe(2);
    expect(result.averageRating).toBe(3);
    expect(result.mostRecent).toMatchObject({ rating: 2, title: "Meh, second time", productTitle: "Red Hat" });
  });

  it("never leaks a match belonging to a different store", async () => {
    reviews.push({
      storeId: "store_2",
      reviewerEmail: "jordan@example.com",
      rating: 5,
      title: "Great",
      productTitle: "Blue Shirt",
      status: "APPROVED",
      deletedAt: null,
      createdAt: new Date(),
    });

    const result = await getCustomerReviewStatsByEmail("store_1", "jordan@example.com");
    expect(result.reviewCount).toBe(0);
  });

  it("excludes soft-deleted reviews", async () => {
    reviews.push({
      storeId: "store_1",
      reviewerEmail: "jordan@example.com",
      rating: 5,
      title: "Great",
      productTitle: "Blue Shirt",
      status: "APPROVED",
      deletedAt: new Date(),
      createdAt: new Date(),
    });

    const result = await getCustomerReviewStatsByEmail("store_1", "jordan@example.com");
    expect(result.reviewCount).toBe(0);
  });
});
