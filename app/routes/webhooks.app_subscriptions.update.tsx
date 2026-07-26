import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getStoreBySlug } from "../services/store.server";
import { syncBillingFromShopify } from "../services/billing/billing.server";

const storeSlugFromShop = (shop: string) => shop.replace(".myshopify.com", "");

// Fired whenever a subscription's status changes (trial ending, payment declined, merchant
// cancels from Shopify's own subscription screen, etc.) — rather than trying to parse the
// webhook payload's subscription fields directly, this just re-runs the same live
// reconciliation the billing page itself uses (syncBillingFromShopify), so there's exactly one
// place that interprets Shopify's subscription state into our local Store cache.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const store = await getStoreBySlug(storeSlugFromShop(shop));

    if (!store || !admin) {
      return new Response();
    }

    await syncBillingFromShopify(admin, store);
    return new Response();
  } catch (error) {
    console.error(`Failed to process ${topic} webhook for ${shop}:`, error);
    return new Response();
  }
};
