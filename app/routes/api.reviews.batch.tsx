import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPublicReviewSummaryBatch } from "../services/review.server";
import { getProductsForStoreByIdentifiers } from "../services/product.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

const MAX_IDENTIFIERS = 100;

function parseList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_IDENTIFIERS);
}

// Public, unauthenticated, App-Proxy-verified batch read for the collection/search rating
// badge embed: one request for every product visible on the page instead of one per card.
// Reuses the same product/review lookups as api.reviews.tsx — only APPROVED reviews ever
// factor into the returned averages/counts.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim() || "";
  const productIds = parseList(url.searchParams.get("productIds"));
  const handles = parseList(url.searchParams.get("handles"));

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  if (productIds.length === 0 && handles.length === 0) {
    return json({ ok: true, byProductId: {}, byHandle: {} });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const [products, appearance] = await Promise.all([
    getProductsForStoreByIdentifiers(store.id, {
      shopifyProductIds: productIds,
      handles,
    }),
    // Store-level, not per-product — every Collection Rating Badge on the page resolves
    // the same tokens the Product Reviews widget and Product Rating Badge do.
    getStorefrontAppearance(store.id),
  ]);

  const summaries = await getPublicReviewSummaryBatch(products.map((product) => product.id));

  const byProductId: Record<string, { averageRating: number; totalReviews: number }> = {};
  const byHandle: Record<string, { averageRating: number; totalReviews: number }> = {};

  for (const product of products) {
    const summary = summaries[product.id] ?? { averageRating: 0, totalReviews: 0 };

    if (product.shopifyProductId) {
      const numericId = product.shopifyProductId.split("/").pop();
      if (numericId) {
        byProductId[numericId] = summary;
      }
    }

    if (product.handle) {
      byHandle[product.handle] = summary;
    }
  }

  return json({ ok: true, byProductId, byHandle, appearance });
};
