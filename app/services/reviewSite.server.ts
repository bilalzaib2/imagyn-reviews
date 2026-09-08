import { getStoreBySlug } from "./store.server";
import { getStoreReviewStats, getStoreReviews, type ReviewWithProduct } from "./review.server";
import { ReviewStatus } from "./review.shared";

const PAGE_SIZE = 12;

export interface ReviewSiteData {
  storeName: string;
  averageRating: number;
  publishedReviews: number;
  reviews: ReviewWithProduct[];
  nextCursor: string | null;
  hasMore: boolean;
}

// The public, shareable "all our reviews" page (reviews-site.$slug.tsx) — a real, promotable
// trust page distinct from the storefront widgets (which only ever show on the merchant's own
// theme) and the machine-readable feeds (Google XML / plain JSON), for a merchant to link from
// an email signature, social bio, or ad landing page. Uses the store's existing public slug
// (already used by getOrCreateStore/getStoreBySlug — the myshopify handle without the domain
// suffix) rather than adding a new token/schema field, since unlike the feeds this page is
// meant to be discoverable and shared, not access-controlled.
export async function getReviewSiteData(slug: string, cursor?: string | null): Promise<ReviewSiteData | null> {
  const store = await getStoreBySlug(slug);
  if (!store) {
    return null;
  }

  const [stats, page] = await Promise.all([
    getStoreReviewStats(store.id),
    getStoreReviews(store.id, { status: ReviewStatus.APPROVED, cursor: cursor ?? undefined, limit: PAGE_SIZE }),
  ]);

  return {
    storeName: store.name,
    averageRating: stats.averageRating,
    publishedReviews: stats.publishedReviews,
    reviews: page.reviews,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

export function getReviewSiteUrl(slug: string): string {
  const appUrl = (process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  return `${appUrl}/reviews-site/${slug}`;
}
