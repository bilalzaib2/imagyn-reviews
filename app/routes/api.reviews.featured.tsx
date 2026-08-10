import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getFeaturedReviews } from "../services/review.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { getStorefrontCarouselSettings } from "../services/widget.server";
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

// Public, unauthenticated, App-Proxy-verified read for the store-wide Review Carousel widget
// (extensions/imagyn-review-widgets/blocks/review_carousel.liquid) — unlike api.reviews.tsx,
// this has no productId: the carousel spans the whole store's real reviews, not one product's.
// Reuses getFeaturedReviews (review.server.ts) — never fabricates or independently computes
// review data here.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  // `shop` is one of the query params covered by the signature just verified above, so
  // it's now a trusted value, not client-supplied.
  const shop = url.searchParams.get("shop")?.trim() || "";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const [reviews, widget, appearance] = await Promise.all([
    getFeaturedReviews(store.id, limit),
    getStorefrontCarouselSettings(store.id),
    // Same centralized Appearance System tokens every other widget on the page resolves.
    getStorefrontAppearance(store.id),
  ]);

  return json({
    ok: true,
    widget,
    appearance,
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
      product: review.product,
      media: review.media.map(serializeMedia),
    })),
  });
};
