import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPublicStoreReviewSummary } from "../services/review.server";
import { getVerifiedStoreMediaGallery } from "../services/reviewMedia.server";
import { getLatestAiSummaryForStore } from "../services/aiSummary.server";
import { getTrustCertification } from "../services/trustCertification.server";
import { PILLAR_STATUS_LABEL, buildPillarViews } from "../services/trustCertification.presentation";
import { getStoreBySlug } from "../services/store.server";
import { getStorefrontAppearance } from "../services/appearance.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// Public, unauthenticated, App-Proxy-verified read for the IMAGYN Trust Badge
// (extensions/imagyn-review-widgets/blocks/trust_badge.liquid) and its click-through modal.
// Same shape/pattern as api.reviews.store.tsx. Deliberately calls getTrustCertification (a pure
// cache read) and NEVER refreshTrustCertification — a storefront request must never trigger a
// live Shopify Admin API call; refreshes only ever happen from an authenticated merchant-admin
// surface (the Dashboard's background refresh or the Settings "Recheck now" action).
//
// Pillar detail is deliberately NOT exposed here — the merchant-facing detail strings
// (trustCertification.server.ts's `reason`/`detail` fields) can mention internal mechanics like
// a missing Shopify API scope, which is meaningless (and a little odd) for a shopper to read.
// Only { key, title, status } is public — enough for a real, honest Met/Pending/Not met
// checklist without leaking merchant-internal implementation detail.
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

  const [trust, summary, media, aiSpotlight, appearance] = await Promise.all([
    getTrustCertification(store.id),
    getPublicStoreReviewSummary(store.id),
    getVerifiedStoreMediaGallery(store.id),
    getLatestAiSummaryForStore(store.id),
    getStorefrontAppearance(store.id),
  ]);

  // No calculation has ever run yet (e.g. a brand-new install whose Dashboard hasn't loaded
  // once) — honestly nothing to show, not a fabricated "pending" state.
  if (!trust) {
    return json({ ok: true, trust: null });
  }

  const pillars = buildPillarViews(trust, null).map((pillar) => ({
    key: pillar.key,
    title: pillar.title,
    status: pillar.status,
    statusLabel: PILLAR_STATUS_LABEL[pillar.status],
  }));

  return json({
    ok: true,
    store: { name: store.name },
    trust: {
      status: trust.status,
      paused: trust.paused,
      verifiedReviewCount: trust.verifiedReviewCount,
      verifiedAverageRating: trust.verifiedAverageRating,
      pillars,
    },
    ratingDistribution: summary.ratingCounts,
    media,
    aiSpotlight: aiSpotlight
      ? {
          productName: aiSpotlight.productName,
          recommendation: aiSpotlight.recommendation,
          positives: aiSpotlight.positives,
          negatives: aiSpotlight.negatives,
        }
      : null,
    appearance,
  });
};
