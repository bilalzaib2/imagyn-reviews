import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { getStoreAiSummary } from "../services/aiSummary.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// Public, unauthenticated, App-Proxy-verified read backing the dedicated "Store AI Summary"
// Theme App Block (extensions/imagyn-review-widgets/blocks/store_ai_summary.liquid) — a
// standalone surface, distinct from the Store Reviews Widget (api.reviews.store.tsx) and the
// per-product AI Review Summary block (api.reviews.tsx). This block has no admin-side on/off
// flag of its own (Store.aiSummaryOnWidgetEnabled/aiSummaryOnReviewSiteEnabled gate the OTHER
// two surfaces, not this one) — a merchant adding or removing this block in the Theme Editor
// IS its own on/off control, matching every other standalone block in this app. No productId
// is ever accepted here; this always reads the one persisted, store-wide summary.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim() || "";

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  const [storeAiSummary, appearance] = await Promise.all([
    getStoreAiSummary(store.id),
    getStorefrontAppearance(store.id, "store_ai_summary"),
  ]);

  return json({
    ok: true,
    appearance,
    storeAiSummary: storeAiSummary
      ? { summary: storeAiSummary.summary, reviewCountUsed: storeAiSummary.reviewCountUsed }
      : null,
  });
};
