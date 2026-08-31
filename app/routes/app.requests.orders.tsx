import type { LoaderFunctionArgs } from "react-router";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { searchShopifyOrders } from "../services/shopifyOrders.server";
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

  try {
    const { orders, hasNextPage, endCursor } = await searchShopifyOrders(admin, store.id, { search, cursor });

    const pairs = orders.flatMap((order) =>
      order.lineItems
        .filter((item) => item.localProductId && order.customerEmail)
        .map((item) => ({ email: order.customerEmail as string, productId: item.localProductId as string })),
    );
    const eligibility = await reviewRequestService.getExistingRequestContextBulk(store.id, pairs);

    const enriched = orders.map((order) => ({
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

    return { ok: true as const, orders: enriched, hasNextPage, endCursor };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to load Shopify orders.",
      orders: [],
      hasNextPage: false,
      endCursor: null,
    };
  }
};
