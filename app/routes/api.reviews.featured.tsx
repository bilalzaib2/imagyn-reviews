import type { LoaderFunctionArgs } from "react-router";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getFeaturedReviews, getPublicReviewSummaryBatch, getPublicStoreReviewSummary } from "../services/review.server";
import { getStoreBySlug } from "../services/store.server";
import { getOrSyncProductForStoreByShopifyId } from "../services/product.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { getStorefrontCarouselSettings } from "../services/widget.server";
import { getAiSummary, getStoreAiSummary } from "../services/aiSummary.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;

function serializeMedia(media: { id: string; type: string; url: string; thumbnailUrl: string | null; width: number | null; height: number | null }) {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    thumbnailUrl: media.thumbnailUrl,
    width: media.width,
    height: media.height,
  };
}

// The carousel has no fixed context of its own — a merchant can place the same block on the
// homepage (store-wide) or on a product page (that product's own reviews still come from
// getFeaturedReviews store-wide, but the AI summary should be product-scoped there). See
// review_carousel.liquid's data-product-id comment: a real Shopify product ID is only ever
// present when this instance happens to render on a product page. Resolves to this store's
// internal Product record the same way api.reviews.tsx does, only when a productId is given
// and only when the AI summary display surface is actually turned on — a store-wide instance
// never pays this cost.
async function getCarouselAiSummary(
  store: { id: string; aiSummaryOnCarouselEnabled: boolean },
  shopifyProductId: string,
  admin: AdminApiContext | undefined,
): Promise<{ summary: string; scope: "product" | "store" } | null> {
  if (!store.aiSummaryOnCarouselEnabled) {
    return null;
  }

  if (shopifyProductId) {
    const product = await getOrSyncProductForStoreByShopifyId(shopifyProductId, store.id, admin);
    if (!product) {
      return null;
    }
    const summary = await getAiSummary(product.id);
    return summary ? { summary: summary.summary, scope: "product" } : null;
  }

  const summary = await getStoreAiSummary(store.id);
  return summary ? { summary: summary.summary, scope: "store" } : null;
}

// Public, unauthenticated, App-Proxy-verified read for the Review Carousel widget
// (extensions/imagyn-review-widgets/blocks/review_carousel.liquid). The review data itself is
// always store-wide (getFeaturedReviews, review.server.ts — never fabricated), regardless of
// which page the block sits on; only the AI summary (see getCarouselAiSummary above) varies
// by placement.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  // `admin` is only needed for getCarouselAiSummary's lazy single-product sync fallback,
  // the same way api.reviews.tsx's loader already uses it.
  const { admin } = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  // `shop` is one of the query params covered by the signature just verified above, so
  // it's now a trusted value, not client-supplied.
  const shop = url.searchParams.get("shop")?.trim() || "";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;
  // Present only when this block instance renders on a product page (see
  // review_carousel.liquid's data-product-id) — a real Shopify product ID, not this store's
  // internal one.
  const productId = url.searchParams.get("productId")?.trim() || "";

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const [reviews, widget, appearance, storeSummary, aiSummary] = await Promise.all([
    getFeaturedReviews(store.id, limit),
    getStorefrontCarouselSettings(store.id),
    // Same centralized Appearance System tokens every other widget on the page resolves.
    getStorefrontAppearance(store.id, "review_carousel"),
    // The store's own real, aggregate rating (all approved reviews, not just the ones
    // featured in this carousel) — the same source getPublicReviewSummaryBatch draws from,
    // just scoped to the whole store instead of one product. Powers the summary row shown
    // above the cards (stars + average + count + verified badge).
    getPublicStoreReviewSummary(store.id),
    getCarouselAiSummary(store, productId, admin),
  ]);

  // Each product's own real aggregate rating (average + total, APPROVED reviews only) — the
  // same getPublicReviewSummaryBatch api.reviews.batch.tsx already uses for the Collection
  // Rating Badge, reused rather than re-derived, so the number shown here can never drift
  // from what that badge (or the Product Reviews Widget) would show for the same product.
  // This is real, secondary metadata about the product, never a second review-level rating.
  const productIds = Array.from(new Set(reviews.map((review) => review.product.id)));
  const productSummaries = await getPublicReviewSummaryBatch(productIds);

  return json({
    ok: true,
    widget,
    appearance,
    storeSummary: {
      averageRating: storeSummary.averageRating,
      totalReviews: storeSummary.totalReviews,
    },
    aiSummary,
    reviews: reviews.map((review) => ({
      id: review.id,
      reviewerName: review.reviewerName,
      // Public trust signal only — same "never expose reviewerEmail/reviewerLocation" rule
      // api.reviews.tsx's loader follows.
      verifiedPurchase: review.verifiedPurchase,
      rating: review.rating,
      title: review.title,
      content: review.content,
      createdAt: review.createdAt,
      product: {
        ...review.product,
        averageRating: productSummaries[review.product.id]?.averageRating ?? 0,
        totalReviews: productSummaries[review.product.id]?.totalReviews ?? 0,
      },
      media: review.media.map(serializeMedia),
    })),
  });
};
