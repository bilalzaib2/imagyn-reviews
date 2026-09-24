import type { LoaderFunctionArgs } from "react-router";
import { ReviewStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import {
  getProductReviews,
  getPublicReviewSummary,
  getPublicStoreReviewSummary,
  getStoreReviews,
} from "../services/review.server";
import { getStoreBySlug } from "../services/store.server";
import { getOrSyncProductForStoreByShopifyId } from "../services/product.server";
import { getGroupedProductIds } from "../services/productGroup.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// How many reviews the drawer loads. The floating drawer is a scannable summary surface, not
// the full Product Reviews widget (which paginates 50 at a time) — a shopper who wants the
// whole list has the real on-page widget for that, and this endpoint runs on every storefront
// page the app embed is enabled on, so its cost stays deliberately small.
const REVIEW_LIMIT = 10;

function serializeMedia(media: {
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
    thumbnailUrl: media.thumbnailUrl,
    width: media.width,
    height: media.height,
  };
}

// Public, unauthenticated, App-Proxy-verified read for the Floating Reviews widget
// (extensions/imagyn-review-widgets/blocks/floating_reviews.liquid). Same shape/pattern as
// api.reviews.store.tsx and api.reviews.featured.tsx: one round trip returning the summary,
// the rating distribution, recent reviews and the resolved brand tokens.
//
// Context awareness (the one thing genuinely new here): the widget is an app embed, so the
// same instance renders on every storefront page. When it happens to render on a product page
// the block passes that product's real Shopify ID and this endpoint answers with that
// product's own reviews and rating; everywhere else it answers store-wide. A product page
// whose product has no approved reviews yet falls back to the store-wide rollup rather than
// rendering an empty drawer — and says so via `scope`, so the widget can label what the
// shopper is actually looking at instead of presenting store numbers as product numbers.
//
// Only APPROVED reviews are ever read (the same definition of "publicly visible" every other
// storefront endpoint in this app uses — see api.reviews.tsx), and only display-safe fields are
// serialized: reviewerEmail and reviewerLocation are never included.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  // `admin` is only used for getOrSyncProductForStoreByShopifyId's lazy single-product sync
  // fallback, exactly as api.reviews.tsx's loader already uses it.
  const { admin } = await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  // `shop` is one of the query params covered by the signature just verified above, so it's a
  // trusted value here, not client-supplied. A storefront-supplied store id is never accepted
  // — the store is always resolved from this verified shop domain.
  const shop = url.searchParams.get("shop")?.trim() || "";
  // Present only when this app embed happens to render on a product page (see
  // floating_reviews.liquid's data-product-id) — a real Shopify product ID, not an internal one.
  const shopifyProductId = url.searchParams.get("productId")?.trim() || "";

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const appearance = await getStorefrontAppearance(store.id, "floating_reviews");

  if (shopifyProductId) {
    // Falls back to a lazy, on-demand single-product sync for a product that hasn't been
    // through a full-catalog sync yet — same helper, same fast path (one DB read) as the
    // Product Reviews widget's own endpoint.
    const product = await getOrSyncProductForStoreByShopifyId(shopifyProductId, store.id, admin);

    if (product) {
      // Product Grouping (Settings > Product Groups): a shopper on one variant-product sees
      // reviews left on any product in its group, exactly as the Product Reviews widget does.
      // Returns [product.id] alone for the overwhelming majority of products, which aren't
      // grouped at all.
      const reviewProductIds = await getGroupedProductIds(product.id);

      const [summary, result] = await Promise.all([
        getPublicReviewSummary(reviewProductIds),
        getProductReviews(reviewProductIds, { status: ReviewStatus.APPROVED, limit: REVIEW_LIMIT }),
      ]);

      if (summary.totalReviews > 0) {
        return json({
          ok: true,
          scope: "product" as const,
          productName: product.name,
          summary,
          appearance,
          reviews: result.reviews.map(serializeReview),
        });
      }
    }
  }

  const [summary, result] = await Promise.all([
    getPublicStoreReviewSummary(store.id),
    getStoreReviews(store.id, { status: ReviewStatus.APPROVED, limit: REVIEW_LIMIT }),
  ]);

  return json({
    ok: true,
    scope: "store" as const,
    productName: null,
    summary,
    appearance,
    reviews: result.reviews.map(serializeReview),
  });
};

function serializeReview(review: {
  id: string;
  reviewerName: string;
  verifiedPurchase: boolean;
  rating: number;
  title: string | null;
  content: string;
  createdAt: Date;
  reply: string | null;
  product: { name: string };
  media: Array<{
    id: string;
    type: string;
    url: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
  }>;
}) {
  return {
    id: review.id,
    reviewerName: review.reviewerName,
    // Public trust signal only — IMAGYN's own verified-purchase flag, never a source
    // platform's imported claim (Review.sourceVerified is deliberately never read here).
    verifiedPurchase: review.verifiedPurchase,
    rating: review.rating,
    // Null when the customer genuinely left no title. Never substituted with the body text.
    title: review.title,
    content: review.content,
    createdAt: review.createdAt,
    // The merchant's own public reply — display-safe as-is, same as api.reviews.tsx.
    reply: review.reply,
    // Which product a store-wide review is actually about; on a product-scoped response every
    // review already belongs to that product (or its group).
    productName: review.product.name,
    media: review.media.map(serializeMedia),
  };
}
