import { getStoreBySlug } from "./store.server";
import { getStoreReviewStats, getStoreReviews, type ReviewWithProduct } from "./review.server";
import { ReviewStatus } from "./review.shared";
import { getStoreAiSummary } from "./aiSummary.server";
import { appearanceService, getStorefrontAppearance } from "./appearance.server";
import type { AppearanceTokens } from "./appearance.shared";

const PAGE_SIZE = 12;

// The display-safe projection of a Review for this page, and the reason it exists:
// reviews-site.$slug.tsx is a PUBLIC, unauthenticated route, and React Router serializes a
// loader's ENTIRE return value into the HTML document for hydration — independently of what
// the component chooses to render. Returning review rows straight from getStoreReviews
// therefore published every Review scalar to anyone who could guess a store slug, because
// review.server.ts's `reviewInclude` deliberately uses Prisma's `include` (correct for the
// admin UI, which needs the whole row) rather than a `select`.
//
// So this layer applies the same explicit field allow-list every other public surface in this
// app already applies — api.reviews.tsx's loader, api.reviews.featured.tsx,
// api.reviews.floating.tsx, api.reviews.video-carousel.tsx and publicDiscovery.server.ts's
// REVIEW_SELECT. The shape mirrors review.server.ts's FeaturedReview, which is this codebase's
// established "store-wide public review" contract.
//
// NEVER add to this interface: reviewerEmail, reviewerLocation, moderationStatus,
// moderationReason, externalId, importSource, importBatchId, sourceVerified, reward (its
// discountCode is a live, redeemable Shopify discount), storeId, isPublished, photoUrls, or
// anything else that isn't already shown to shoppers on the merchant's own storefront.
export interface PublicSiteReview {
  id: string;
  reviewerName: string;
  verifiedPurchase: boolean;
  rating: number;
  title: string | null;
  content: string;
  createdAt: Date;
  product: { id: string; name: string; handle: string | null; featuredImage: string | null };
  media: Array<{
    id: string;
    type: string;
    url: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
}

// Explicit, field-by-field — never a spread of the Prisma row. Adding a column to the Review
// model can therefore never silently publish it, which is the same guarantee
// publicDiscovery.server.ts's header states for the consumer network.
function toPublicSiteReview(review: ReviewWithProduct): PublicSiteReview {
  return {
    id: review.id,
    reviewerName: review.reviewerName,
    verifiedPurchase: review.verifiedPurchase,
    rating: review.rating,
    title: review.title,
    content: review.content,
    createdAt: review.createdAt,
    product: {
      id: review.product.id,
      name: review.product.name,
      handle: review.product.handle,
      featuredImage: review.product.featuredImage,
    },
    media: review.media.map((item) => ({
      id: item.id,
      type: item.type,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl,
      width: item.width,
      height: item.height,
    })),
  };
}

export interface ReviewSiteData {
  storeName: string;
  averageRating: number;
  publishedReviews: number;
  // Real, already-computed distribution (same query getStoreReviewStats' Dashboard caller
  // uses) — added so the public page can show a genuine rating breakdown instead of just the
  // single average number, without a second query.
  ratingCounts: { 5: number; 4: number; 3: number; 2: number; 1: number };
  // Display-safe only — see PublicSiteReview above for why this is NOT ReviewWithProduct.
  reviews: PublicSiteReview[];
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

  // "Discoverable and shared" is not the same as "published regardless of consent". This page is
  // a public surface, and publicDiscovery.server.ts's PUBLIC_STORE gate — the one whose own
  // comment promises that turning publicNetworkEnabled off "removes the store, its products and
  // its reviews from every public surface, including counts, facets, search, the sitemap and
  // structured data" — was not applied here. Resolving by slug alone meant a merchant who
  // explicitly opted out still had their reviews served, and every development store had a live
  // public page. Both are now 404s, exactly as an unknown slug is.
  //
  // Checked against `=== false` / `=== true` rather than truthiness: publicNetworkEnabled
  // defaults to true in the schema and isDevelopmentStore is nullable, so an unset value means
  // "ordinary participating production store", not "block it".
  if (store.publicNetworkEnabled === false || store.isDevelopmentStore === true) {
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
    reviews: page.reviews.map(toPublicSiteReview),
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
