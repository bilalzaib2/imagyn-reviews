import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPublicReviewSummaryBatch, getVideoReviews } from "../services/review.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { getStorePermissions } from "../services/permissions";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// Public, unauthenticated, App-Proxy-verified read for the Video Reviews Carousel widget
// (extensions/imagyn-review-widgets/blocks/video_reviews_carousel.liquid).
//
// THIS FILE IS THE PRO GATE. Hiding the widget card in the admin is a courtesy; this is the
// enforcement. A Free store that adds the block by hand in the Theme Editor, or replays this
// URL directly, gets an empty payload — there is no path to rendered video that does not come
// through here, because the block ships no review data of its own.
//
// Reviews are always store-wide. Unlike the Review Carousel there is deliberately no
// backfill: a video carousel padded with text-only reviews is not a video carousel, so a
// store with two eligible videos gets a two-card carousel and a store with none renders the
// block's empty state.

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 24;

/**
 * A media row is only sent to the storefront if its URL is one a `<video>`/`<img>` element can
 * actually and safely load.
 *
 * These URLs are written by this app's own upload path (storage/shopifyFiles.server.ts, so in
 * practice cdn.shopify.com), which makes this defence-in-depth rather than the primary
 * control — but the renderer puts these straight into `src` attributes, so anything that
 * isn't plain http(s) is dropped rather than trusted. `javascript:` and `data:` in particular
 * must never reach an attribute, and a malformed row from an import or a manual edit should
 * degrade to "no video" instead of a broken player.
 */
function isPlayableMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function serializeVideo(media: {
  id: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}) {
  return {
    id: media.id,
    type: media.type,
    url: media.url,
    // A missing poster is normal, not an error — the widget falls back to the product image
    // and then to a plain play affordance. Only drop a poster that isn't loadable.
    thumbnailUrl: media.thumbnailUrl && isPlayableMediaUrl(media.thumbnailUrl) ? media.thumbnailUrl : null,
    width: media.width,
    height: media.height,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App Proxy
  // (missing/invalid signature) — this is what rejects non-Shopify traffic. No `admin` client
  // is needed here: this widget is store-wide and never does a lazy product sync.
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  // Covered by the signature verified above, so this is a trusted value rather than a
  // client-supplied one.
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

  // Resolved from the store's real billing state (billing.server.ts via permissions.ts) —
  // never from a query param, a block setting, or anything else the page could assert.
  const permissions = await getStorePermissions(store.id);

  if (!permissions.canUseVideoReviewsCarousel) {
    // `ok: true` with an empty list, not an error: a downgraded store's storefront should
    // quietly stop showing the carousel, not log errors on every page view or flash a broken
    // widget at shoppers. `locked` lets the block distinguish "not entitled" from "no videos
    // yet" so it can pick the right (merchant-invisible) behaviour, and nothing about the
    // merchant's saved block settings or their reviews is touched — re-upgrading restores the
    // carousel with no further action.
    return json({ ok: true, locked: true, reviews: [], appearance: null });
  }

  const [reviews, appearance] = await Promise.all([
    getVideoReviews(store.id, limit),
    // Its own Brand Studio surface, not the Review Carousel's — colour, typography and card
    // styling for this widget are configured there (global tokens, optionally overridden per
    // surface), which is why this block's Theme Editor schema deliberately carries no
    // competing colour controls of its own.
    getStorefrontAppearance(store.id, "video_reviews_carousel"),
  ]);

  // Drop any review whose video didn't survive URL validation rather than shipping a card
  // with an unplayable source.
  const playable = reviews
    .map((review) => ({ ...review, media: review.media.filter((item) => isPlayableMediaUrl(item.url)) }))
    .filter((review) => review.media.length > 0);

  // Each product's own real aggregate rating — the same getPublicReviewSummaryBatch the
  // Collection Rating Badge and Review Carousel already use, reused rather than re-derived so
  // the number here can never drift from what those show for the same product.
  const productIds = Array.from(new Set(playable.map((review) => review.product.id)));
  const productSummaries = await getPublicReviewSummaryBatch(productIds);

  return json({
    ok: true,
    locked: false,
    appearance,
    reviews: playable.map((review) => ({
      id: review.id,
      reviewerName: review.reviewerName,
      // Public trust signals only. reviewerEmail, reviewerLocation, moderation fields and
      // every other internal column stay server-side — same rule api.reviews.tsx follows.
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
        averageRating: productSummaries[review.product.id]?.averageRating ?? 0,
        totalReviews: productSummaries[review.product.id]?.totalReviews ?? 0,
      },
      media: review.media.map(serializeVideo),
    })),
  });
};
