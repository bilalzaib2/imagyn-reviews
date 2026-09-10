import { getStoreBySlug } from "./store.server";
import { getStoreReviewStats, getStoreReviews, type ReviewWithProduct } from "./review.server";
import { ReviewStatus } from "./review.shared";
import { getStoreAiSummary } from "./aiSummary.server";
import { appearanceService, getStorefrontAppearance } from "./appearance.server";
import type { AppearanceTokens } from "./appearance.shared";

const PAGE_SIZE = 12;

export interface ReviewSiteData {
  storeName: string;
  averageRating: number;
  publishedReviews: number;
  // Real, already-computed distribution (same query getStoreReviewStats' Dashboard caller
  // uses) — added so the public page can show a genuine rating breakdown instead of just the
  // single average number, without a second query.
  ratingCounts: { 5: number; 4: number; 3: number; 2: number; 1: number };
  reviews: ReviewWithProduct[];
  nextCursor: string | null;
  hasMore: boolean;
  // The real, persisted Store AI Summary (never a per-product fallback) — only populated when
  // the merchant has turned this surface on (Store.aiSummaryOnReviewSiteEnabled) AND a summary
  // has actually been generated. null means either "disabled" or "not generated yet"; this
  // page never needs to distinguish the two, since both render the same "nothing here" state.
  storeAiSummary: { summary: string; reviewCountUsed: number } | null;
  // Global Brand inheritance (Brand Studio) — the same resolved tokens (global, merged with
  // a "public_review_site" override if the merchant has set one) every other customer-facing
  // surface renders from. See reviews-site.$slug.tsx for how these become real CSS custom
  // properties on the page.
  appearance: AppearanceTokens;
  // Whether the merchant has ever actually saved a Brand Studio configuration. This page's
  // own CSS defaults (review-site.module.css) were designed independently of
  // AppearanceTokens' own defaults and don't numerically match them (e.g. --radius-lg is
  // 16px here vs. AppearanceTokens' 8px default) — unlike the storefront widget CSS, which
  // was deliberately co-designed to match AppearanceTokens' defaults exactly (see
  // appearance.shared.ts's own doc comment on getDefaultAppearanceTokens). Applying
  // `appearance` unconditionally would therefore re-skin this page for every store that has
  // never opened Brand Studio. Gating on this flag preserves the same "nothing changes until
  // a merchant actually configures a brand" guarantee the rest of the system relies on.
  hasCustomBrand: boolean;
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

  const [stats, page, storeAiSummary, appearance, activeAppearance] = await Promise.all([
    getStoreReviewStats(store.id),
    getStoreReviews(store.id, { status: ReviewStatus.APPROVED, cursor: cursor ?? undefined, limit: PAGE_SIZE }),
    // Pure cache read (never generates) — only fetched when the merchant has actually turned
    // this surface on.
    store.aiSummaryOnReviewSiteEnabled ? getStoreAiSummary(store.id) : Promise.resolve(null),
    getStorefrontAppearance(store.id, "public_review_site"),
    appearanceService.getActive(store.id),
  ]);

  return {
    storeName: store.name,
    averageRating: stats.averageRating,
    publishedReviews: stats.publishedReviews,
    ratingCounts: stats.ratingCounts,
    reviews: page.reviews,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    storeAiSummary: storeAiSummary
      ? { summary: storeAiSummary.summary, reviewCountUsed: storeAiSummary.reviewCountUsed }
      : null,
    appearance,
    hasCustomBrand: activeAppearance !== null,
  };
}

export function getReviewSiteUrl(slug: string): string {
  const appUrl = (process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
  return `${appUrl}/reviews-site/${slug}`;
}
