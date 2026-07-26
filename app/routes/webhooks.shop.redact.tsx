import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteStore, getSlug, getStoreBySlug } from "../services/store.server";
import db from "../db.server";

interface ShopRedactPayload {
  shop_id: number;
  shop_domain: string;
}

// Mandatory GDPR compliance webhook — fires ~48 hours after uninstall. Every model in this
// schema (Product, Review, ReviewRequest, Widget, Appearance, and their own children) cascades
// from Store (onDelete: Cascade), so deleting the Store row is a complete, correct erasure of
// all shop data in one statement — reuses the existing deleteStore(), no new deletion logic.
// Session rows are deleted defensively too: webhooks.app.uninstalled.tsx already does this at
// uninstall time, but shop/redact must not depend on that having succeeded.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const data = payload as unknown as ShopRedactPayload;

  console.log(`Received ${topic} webhook for ${shop}`, { shopId: data?.shop_id });

  try {
    await db.session.deleteMany({ where: { shop } });

    const store = await getStoreBySlug(getSlug(shop));

    if (!store) {
      console.log(`No matching store for ${topic} (${shop}) — nothing to redact.`);
      return new Response();
    }

    await deleteStore(store.id);
    console.log(`[GDPR] shop/redact for ${shop}: deleted store ${store.id} and all related data.`);

    return new Response();
  } catch (error) {
    console.error(`Failed to process ${topic} webhook for ${shop}:`, error);
    return new Response();
  }
};
