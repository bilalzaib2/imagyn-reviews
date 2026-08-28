import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getEarnedMedalsForStorefront } from "../services/achievements.server";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// Public, unauthenticated, App-Proxy-verified read for the store-wide Medals Showcase widget
// (extensions/imagyn-review-widgets/blocks/medals_showcase.liquid) — same shape/pattern as
// api.reviews.featured.tsx's Review Carousel endpoint. Store-wide, not per-product: a
// merchant's earned medals aren't tied to any one product. Reuses
// getEarnedMedalsForStorefront (achievements.server.ts) exactly as api.reviews.tsx's
// per-product bundle already does — never independently computes or fabricates medal data
// here, and never touches the Achievement ledger (read-only).
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

  const [medals, appearance] = await Promise.all([
    getEarnedMedalsForStorefront(store.id),
    // Same centralized Appearance System tokens every other widget on the page resolves —
    // only the heading text uses these (the medallion artwork itself is intentionally
    // fixed brushed-metal tones, not brand-accent colored, see Medallion.tsx).
    getStorefrontAppearance(store.id),
  ]);

  return json({ ok: true, medals, appearance });
};
