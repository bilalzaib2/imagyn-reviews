import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getSlug, getStoreBySlug } from "../services/store.server";
import db from "../db.server";

interface CustomersDataRequestPayload {
  shop_id: number;
  shop_domain: string;
  customer: { id: number; email?: string | null; phone?: string | null };
  orders_requested?: number[];
  data_request: { id: number };
}

// Mandatory GDPR compliance webhook. This app has no automated data-export pipeline (out of
// scope for a "minimal" implementation) — the compliance requirement it satisfies is that the
// app is instrumented to detect the request and produce an auditable record of exactly what
// personal data it holds for this customer, so the merchant/developer can fulfill Shopify's
// 30-day response window manually. Nothing is deleted or modified here — data_request is a
// read-and-disclose obligation, distinct from customers/redact and shop/redact.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const data = payload as unknown as CustomersDataRequestPayload;

  console.log(`Received ${topic} webhook for ${shop}`, {
    dataRequestId: data.data_request?.id,
    customerId: data.customer?.id,
  });

  try {
    const store = await getStoreBySlug(getSlug(shop));
    const email = data.customer?.email;

    if (!store || !email) {
      console.log(`No matching store or customer email for ${topic} (${shop}) — nothing on file.`);
      return new Response();
    }

    const [reviews, reviewRequests] = await Promise.all([
      db.review.findMany({
        where: { storeId: store.id, reviewerEmail: email },
        select: { id: true, createdAt: true },
      }),
      db.reviewRequest.findMany({
        where: { storeId: store.id, email },
        select: { id: true, createdAt: true },
      }),
    ]);

    console.log(
      `[GDPR] customers/data_request for ${shop}, customer ${data.customer.id} (${email}): ` +
        `${reviews.length} review(s), ${reviewRequests.length} review request(s) on file.`,
      { reviewIds: reviews.map((review) => review.id), reviewRequestIds: reviewRequests.map((item) => item.id) },
    );

    return new Response();
  } catch (error) {
    console.error(`Failed to process ${topic} webhook for ${shop}:`, error);
    return new Response();
  }
};
