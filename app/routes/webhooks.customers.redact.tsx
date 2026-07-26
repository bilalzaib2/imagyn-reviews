import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSlug, getStoreBySlug } from "../services/store.server";
import db from "../db.server";

interface CustomersRedactPayload {
  shop_id: number;
  shop_domain: string;
  customer: { id: number; email?: string | null; phone?: string | null };
  orders_to_redact?: number[];
}

// Mandatory GDPR compliance webhook. Redacts (not deletes) this customer's personal data —
// their review content itself is the merchant's storefront content, not the customer's
// personal data, so it's kept; only the identifying fields (email, name) are cleared. Fires
// per-customer, independent of shop/redact (which removes everything, for the whole shop, on
// uninstall).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const data = payload as unknown as CustomersRedactPayload;

  console.log(`Received ${topic} webhook for ${shop}`, { customerId: data.customer?.id });

  try {
    const store = await getStoreBySlug(getSlug(shop));
    const email = data.customer?.email;

    if (!store || !email) {
      console.log(`No matching store or customer email for ${topic} (${shop}) — nothing to redact.`);
      return new Response();
    }

    const [redactedReviews, redactedRequests] = await Promise.all([
      db.review.updateMany({
        where: { storeId: store.id, reviewerEmail: email },
        data: { reviewerEmail: null, reviewerName: "Redacted customer", reviewerLocation: null },
      }),
      db.reviewRequest.updateMany({
        where: { storeId: store.id, email },
        data: { email: null, name: "Redacted customer" },
      }),
    ]);

    console.log(
      `[GDPR] customers/redact for ${shop}, customer ${data.customer.id}: ` +
        `redacted ${redactedReviews.count} review(s), ${redactedRequests.count} review request(s).`,
    );

    return new Response();
  } catch (error) {
    console.error(`Failed to process ${topic} webhook for ${shop}:`, error);
    return new Response();
  }
};
