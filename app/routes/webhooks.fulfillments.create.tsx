import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProductForStoreByShopifyId } from "../services/product.server";
import { reviewRequestService } from "../services/review-request.server";
import { ORDER_AUTOMATION_ENABLED } from "../config/features";

interface FulfillmentLineItem {
  id: number;
  product_id: number | null;
}

interface FulfillmentWebhookPayload {
  order_id: number;
  name?: string | null;
  email?: string | null;
  destination?: { first_name?: string | null; last_name?: string | null } | null;
  line_items?: FulfillmentLineItem[];
}

const isUniqueConstraintViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

// Auto-creates a Review Request per fulfilled line item, per the store's automation settings
// (Store.autoRequestEnabled / autoRequestDelayDays — see app.settings.tsx). Follows the same
// authenticate.webhook + console.log convention as webhooks.app.uninstalled.tsx; unlike that
// handler, this one does real lookups against a webhook-supplied payload, so it's wrapped in a
// try/catch — a malformed or unexpected payload should never surface as a 500 to Shopify.
//
// Not currently reachable: fulfillments/create isn't subscribed in shopify.app.toml pending
// Shopify's Protected Customer Data approval (see the comment there). The ORDER_AUTOMATION_ENABLED
// check below is defense-in-depth for the moment the subscription is restored ahead of the
// flag being flipped.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!ORDER_AUTOMATION_ENABLED) {
    return new Response();
  }

  try {
    const fulfillment = payload as unknown as FulfillmentWebhookPayload;
    const store = await getOrCreateStore(shop);

    if (!store.autoRequestEnabled) {
      return new Response();
    }

    const email = fulfillment.email;
    const lineItems = fulfillment.line_items ?? [];

    if (!email || lineItems.length === 0) {
      console.log(`Skipping ${topic} for ${shop}: no customer email or line items on the payload.`);
      return new Response();
    }

    const customerName =
      [fulfillment.destination?.first_name, fulfillment.destination?.last_name].filter(Boolean).join(" ") || email;

    for (const lineItem of lineItems) {
      if (!lineItem.product_id) {
        continue;
      }

      const product = await getProductForStoreByShopifyId(String(lineItem.product_id), store.id);

      if (!product) {
        // Not a synced product (e.g. added to the catalog after the last "Sync Products" run) —
        // skip rather than fail the whole fulfillment.
        continue;
      }

      try {
        await reviewRequestService.createFromOrder({
          storeId: store.id,
          productId: product.id,
          shopifyOrderId: String(fulfillment.order_id),
          shopifyLineItemId: String(lineItem.id),
          orderNumber: fulfillment.name ?? String(fulfillment.order_id),
          email,
          name: customerName,
          delayDays: store.autoRequestDelayDays,
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          // Shopify's webhook delivery is at-least-once — a request for this (order, product)
          // pair already exists, which is exactly the intended, idempotent outcome.
          continue;
        }

        throw error;
      }
    }

    return new Response();
  } catch (error) {
    console.error(`Failed to process ${topic} webhook for ${shop}:`, error);
    return new Response();
  }
};
