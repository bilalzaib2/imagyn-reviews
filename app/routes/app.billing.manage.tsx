import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getPricingPlansUrl } from "../services/billing/billing.server";

// The only entry point for every paid-plan action (upgrade, downgrade, cancel) — Shopify
// Managed Pricing hosts the actual plan-selection/purchase screen itself, so this route's only
// job is getting the merchant there. It has to be a real top-level navigation, not a fetcher:
// `redirect(..., { target: "_top" })` is what breaks the merchant out of the embedded iframe
// (Shopify Admin's hosted charges page can't render inside it), using the same App
// Bridge-mediated mechanism @shopify/shopify-app-react-router uses for every other
// out-of-app redirect.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const pricingPlansUrl = await getPricingPlansUrl(admin, session.shop);

  return redirect(pricingPlansUrl, { target: "_top" });
};
