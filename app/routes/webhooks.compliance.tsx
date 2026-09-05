import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteStore, getSlug, getStoreBySlug } from "../services/store.server";
import { recordDataAccess } from "../services/auditLog.server";
import db from "../db.server";

// Shopify's three mandatory GDPR compliance topics (customers/data_request, customers/redact,
// shop/redact) are registered as `compliance_topics` on a single subscription block sharing
// one `uri` — Shopify does not support a separate URI per compliance topic (confirmed against
// shopify.dev's app-configuration reference). This route dispatches on the `topic` the SDK
// already extracts from Shopify's signed request, one handler function per topic below.

interface CustomersDataRequestPayload {
  shop_id: number;
  customer: { id: number; email?: string | null; phone?: string | null };
  data_request: { id: number };
}

interface CustomersRedactPayload {
  shop_id: number;
  customer: { id: number; email?: string | null; phone?: string | null };
}

// Read-and-disclose obligation, not a deletion — logs an auditable record of exactly what
// personal data this app holds for the customer, for the merchant/developer to fulfill
// Shopify's 30-day response window manually. No automated export pipeline (out of scope for a
// minimal implementation).
async function handleCustomersDataRequest(shop: string, payload: CustomersDataRequestPayload) {
  const store = await getStoreBySlug(getSlug(shop));
  const email = payload.customer?.email;

  if (!store || !email) {
    console.log(`[GDPR] customers/data_request for ${shop}: no matching store or customer email on file.`);
    await recordDataAccess({
      storeId: store?.id ?? null,
      actor: "webhook:customers_data_request",
      action: "data_request",
      resource: "review.contact_fields",
      success: true,
      detail: "no matching store or customer email on file",
    });
    return;
  }

  const [reviews, reviewRequests] = await Promise.all([
    db.review.findMany({ where: { storeId: store.id, reviewerEmail: email }, select: { id: true } }),
    db.reviewRequest.findMany({ where: { storeId: store.id, email }, select: { id: true } }),
  ]);

  console.log(
    `[GDPR] customers/data_request for ${shop}, customer ${payload.customer.id} (${email}): ` +
      `${reviews.length} review(s), ${reviewRequests.length} review request(s) on file.`,
    { reviewIds: reviews.map((review) => review.id), reviewRequestIds: reviewRequests.map((item) => item.id) },
  );

  await recordDataAccess({
    storeId: store.id,
    actor: "webhook:customers_data_request",
    action: "data_request",
    resource: "review.contact_fields",
    success: true,
    detail: `${reviews.length} review(s), ${reviewRequests.length} review request(s) on file`,
  });
}

// Redacts (not deletes) the customer's identifying fields — their review content is the
// merchant's storefront content, not the customer's personal data, so it's kept.
async function handleCustomersRedact(shop: string, payload: CustomersRedactPayload) {
  const store = await getStoreBySlug(getSlug(shop));
  const email = payload.customer?.email;

  if (!store || !email) {
    console.log(`[GDPR] customers/redact for ${shop}: no matching store or customer email — nothing to redact.`);
    await recordDataAccess({
      storeId: store?.id ?? null,
      actor: "webhook:customers_redact",
      action: "redact",
      resource: "review.contact_fields",
      success: true,
      detail: "no matching store or customer email — nothing to redact",
    });
    return;
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
    `[GDPR] customers/redact for ${shop}, customer ${payload.customer.id}: ` +
      `redacted ${redactedReviews.count} review(s), ${redactedRequests.count} review request(s).`,
  );

  await recordDataAccess({
    storeId: store.id,
    actor: "webhook:customers_redact",
    action: "redact",
    resource: "review.contact_fields",
    success: true,
    detail: `redacted ${redactedReviews.count} review(s), ${redactedRequests.count} review request(s)`,
  });
}

// Fires ~48 hours after uninstall. Every model in this schema cascades from Store (onDelete:
// Cascade), so deleting the Store row is a complete, correct erasure of all shop data —
// reuses the existing deleteStore(). Session rows are deleted defensively too:
// webhooks.app.uninstalled.tsx already does this at uninstall time, but shop/redact must not
// depend on that having succeeded.
async function handleShopRedact(shop: string) {
  await db.session.deleteMany({ where: { shop } });

  const store = await getStoreBySlug(getSlug(shop));

  if (!store) {
    console.log(`[GDPR] shop/redact for ${shop}: no matching store — nothing to redact.`);
    await recordDataAccess({
      storeId: null,
      actor: "webhook:shop_redact",
      action: "redact",
      resource: "store.all_data",
      success: true,
      detail: "no matching store — nothing to redact",
    });
    return;
  }

  // Logged before the delete, not after — deleteStore cascades to AuditLog too (onDelete:
  // SetNull only detaches storeId, it doesn't block the delete from completing first), so
  // this row is what actually survives as evidence the redaction happened; storeId reads
  // back as null afterward, which is expected and correct.
  await recordDataAccess({
    storeId: store.id,
    actor: "webhook:shop_redact",
    action: "redact",
    resource: "store.all_data",
    success: true,
    detail: "deleted store and all related data",
  });

  await deleteStore(store.id);
  console.log(`[GDPR] shop/redact for ${shop}: deleted store ${store.id} and all related data.`);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        await handleCustomersDataRequest(shop, payload as unknown as CustomersDataRequestPayload);
        break;
      case "CUSTOMERS_REDACT":
        await handleCustomersRedact(shop, payload as unknown as CustomersRedactPayload);
        break;
      case "SHOP_REDACT":
        await handleShopRedact(shop);
        break;
      default:
        console.log(`Unrecognized compliance topic ${topic} for ${shop} — ignoring.`);
    }

    return new Response();
  } catch (error) {
    console.error(`Failed to process ${topic} webhook for ${shop}:`, error);

    // Only the three real compliance topics represent an actual protected-data-access
    // attempt worth auditing — an unrecognized topic never reaches a handler above, so an
    // error here couldn't be a failed data/redact operation in the first place.
    if (topic === "CUSTOMERS_DATA_REQUEST" || topic === "CUSTOMERS_REDACT" || topic === "SHOP_REDACT") {
      await recordDataAccess({
        storeId: null,
        actor:
          topic === "CUSTOMERS_DATA_REQUEST"
            ? "webhook:customers_data_request"
            : topic === "CUSTOMERS_REDACT"
              ? "webhook:customers_redact"
              : "webhook:shop_redact",
        action: topic === "CUSTOMERS_DATA_REQUEST" ? "data_request" : "redact",
        resource: topic === "SHOP_REDACT" ? "store.all_data" : "review.contact_fields",
        success: false,
        detail: error instanceof Error ? error.name : "unknown error",
      });
    }

    return new Response();
  }
};
