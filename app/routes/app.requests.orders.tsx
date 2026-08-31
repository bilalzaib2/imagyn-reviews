import type { LoaderFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { ProtectedCustomerDataError, searchShopifyOrders } from "../services/shopifyOrders.server";
import { reviewRequestService } from "../services/review-request.server";

// Resource route backing the "Send Request → Shopify Orders" tab (app.requests.tsx) — real,
// live Shopify order/customer data via the Admin GraphQL API (read_orders/read_customers,
// see shopify.app.toml), fetched on demand as the merchant types a search rather than loaded
// with the page. Every order/line-item is annotated with the exact same duplicate-prevention
// checks (getExistingRequestContextBulk) the automatic webhook path and the existing manual
// "Individual Customer" flow both already use — one eligibility source of truth, not a third
// copy of this logic.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const url = new URL(request.url);
  const search = url.searchParams.get("search") ?? "";
  const cursor = url.searchParams.get("cursor");
  const fulfillmentStatusParam = url.searchParams.get("fulfillmentStatus");
  const fulfillmentStatus =
    fulfillmentStatusParam === "fulfilled" || fulfillmentStatusParam === "unfulfilled" ? fulfillmentStatusParam : undefined;
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;
  const reviewStatusParam = url.searchParams.get("reviewStatus");
  const reviewStatus =
    reviewStatusParam === "eligible" ||
    reviewStatusParam === "requested" ||
    reviewStatusParam === "reviewed" ||
    reviewStatusParam === "no-review" ||
    reviewStatusParam === "not-requested"
      ? reviewStatusParam
      : undefined;
  const productId = url.searchParams.get("productId") || undefined;

  try {
    const { orders, hasNextPage, endCursor } = await searchShopifyOrders(admin, store.id, {
      search,
      cursor,
      fulfillmentStatus,
      dateFrom,
      dateTo,
    });

    const pairs = orders.flatMap((order) =>
      order.lineItems
        .filter((item) => item.localProductId && order.customerEmail)
        .map((item) => ({ email: order.customerEmail as string, productId: item.localProductId as string })),
    );
    const eligibility = await reviewRequestService.getExistingRequestContextBulk(store.id, pairs);

    let enriched = orders.map((order) => ({
      ...order,
      lineItems: order.lineItems.map((item) => {
        const key =
          order.customerEmail && item.localProductId
            ? `${order.customerEmail.toLowerCase()}||${item.localProductId}`
            : null;
        const context = key ? eligibility.get(key) : undefined;

        return {
          ...item,
          hasExistingReview: context?.hasExistingReview ?? false,
          hasPendingRequest: context?.hasPendingRequest ?? false,
          hasSentRequest: context?.hasSentRequest ?? false,
        };
      }),
    }));

    // Shopify's order search has no product-title/id field and no review-request-state field —
    // both are this app's own data, so they're filtered here, after enrichment, against the
    // real line items/eligibility just computed above rather than faked or skipped.
    if (productId) {
      enriched = enriched
        .map((order) => ({ ...order, lineItems: order.lineItems.filter((item) => item.localProductId === productId) }))
        .filter((order) => order.lineItems.length > 0);
    }

    if (reviewStatus) {
      enriched = enriched
        .map((order) => ({
          ...order,
          lineItems: order.lineItems.filter((item) => {
            const isEligible =
              Boolean(order.customerEmail) &&
              Boolean(item.localProductId) &&
              !item.hasExistingReview &&
              !item.hasPendingRequest &&
              !item.hasSentRequest;

            switch (reviewStatus) {
              case "eligible":
                return isEligible;
              case "requested":
                return item.hasPendingRequest || item.hasSentRequest;
              case "reviewed":
                return item.hasExistingReview;
              case "no-review":
                return !item.hasExistingReview;
              case "not-requested":
                return !item.hasPendingRequest && !item.hasSentRequest;
              default:
                return true;
            }
          }),
        }))
        .filter((order) => order.lineItems.length > 0);
    }

    return { ok: true as const, orders: enriched, hasNextPage, endCursor };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to load Shopify orders.",
      // Distinguishes "Shopify explicitly rejected this because of Protected Customer Data
      // approval" from any other failure (network, throttling, a genuine bug) — the UI shows
      // this one differently (a real, expected-for-now limitation) rather than as a generic
      // "something went wrong" error.
      reason: error instanceof ProtectedCustomerDataError ? ("protected_customer_data" as const) : undefined,
      orders: [],
      hasNextPage: false,
      endCursor: null,
    };
  }
};
