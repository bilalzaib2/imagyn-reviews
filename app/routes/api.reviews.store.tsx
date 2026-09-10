import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPublicStoreReviewSummary } from "../services/review.server";
import { getEarnedMedalsForStorefront } from "../services/achievements.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { getStoreAiSummary } from "../services/aiSummary.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// Public, unauthenticated, App-Proxy-verified read for the Store Reviews widget
// (extensions/imagyn-review-widgets/blocks/store_reviews.liquid) — same shape/pattern as
// api.reviews.medals.tsx and api.reviews.featured.tsx. Store-wide, not per-product: this is a
// rollup of the store's own real product reviews (getPublicStoreReviewSummary), not a separate
// "store review" entity — no such concept exists in the schema, and this never fabricates one.
// Bundles the summary + earned medals + appearance tokens in one response so the widget needs
// only one round trip, matching api.reviews.tsx's own per-product bundling.
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

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const [summary, medals, appearance, storeAiSummary] = await Promise.all([
    getPublicStoreReviewSummary(store.id),
    getEarnedMedalsForStorefront(store.id),
    getStorefrontAppearance(store.id),
    // Pure cache read (never generates) — only fetched at all when the merchant has actually
    // turned this surface on, and only ever the real persisted Store AI Summary, never a
    // per-product fallback. Omitted from the response entirely when the merchant hasn't
    // enabled it, so the widget's own "render nothing until present" check needs no separate
    // enabled/disabled flag threaded through — the data's absence *is* the signal.
    store.aiSummaryOnWidgetEnabled ? getStoreAiSummary(store.id) : Promise.resolve(null),
  ]);

  return json({
    ok: true,
    summary,
    medals,
    appearance,
    storeAiSummary: storeAiSummary
      ? { summary: storeAiSummary.summary, reviewCountUsed: storeAiSummary.reviewCountUsed }
      : null,
  });
};
