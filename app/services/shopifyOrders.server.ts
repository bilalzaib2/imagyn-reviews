import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

// The real Shopify order/customer data layer — the single source of truth both the manual
// "Send Request → Shopify Orders" picker and (once ORDER_AUTOMATION_ENABLED flips on) the
// automatic request engine read from. Requires the read_orders/read_customers scopes (see
// shopify.app.toml) — on a live, non-development store, Shopify may withhold or redact the
// actual protected fields (customer name/email) on these objects until this app completes
// Protected Customer Data approval; every field read here is optional/nullable for exactly
// that reason, never assumed present.

const ORDERS_PAGE_SIZE = 25;

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// Deliberately simpler than product.server.ts's graphqlWithThrottleHandling — this queries a
// small, user-triggered page (the Send Request picker), not a full-catalog background sync, so
// the cost-based throttle budget it exists to pace against isn't a realistic concern here. One
// retry on a THROTTLED response is enough; a real sync-scale throttle handler would be
// over-engineering for this call pattern.
async function adminGraphql<T>(admin: AdminApiContext, query: string, variables?: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await admin.graphql(query, variables ? { variables } : undefined);
    const json = (await response.json()) as GraphqlEnvelope<T>;

    if (json.errors?.some((error) => /throttle/i.test(error.message)) && attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors.map((error) => error.message).join(" "));
    }

    if (!json.data) {
      throw new Error("Shopify did not return any data.");
    }

    return json.data;
  }

  throw new Error("Shopify API rate limit exceeded.");
}

export interface ShopifyOrderLineItem {
  shopifyLineItemId: string;
  title: string;
  quantity: number;
  shopifyProductId: string | null;
  // Set only when the line item's product is already synced into this store's catalog — a
  // review request needs a local Product row (see review-request.server.ts's createFromOrder),
  // so a line item with no local match is shown but genuinely can't be requested yet.
  localProductId: string | null;
  localProductName: string | null;
}

export interface ShopifyOrderSummary {
  shopifyOrderId: string;
  orderNumber: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  customerName: string | null;
  customerEmail: string | null;
  lineItems: ShopifyOrderLineItem[];
}

interface OrdersQueryResponse {
  orders: {
    edges: Array<{
      cursor: string;
      node: {
        id: string;
        name: string;
        createdAt: string;
        displayFulfillmentStatus: string;
        displayFinancialStatus: string;
        customer: { firstName: string | null; lastName: string | null; email: string | null } | null;
        lineItems: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              quantity: number;
              product: { id: string } | null;
            };
          }>;
        };
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const ORDERS_QUERY = `#graphql
  query ImagynOrdersForRequests($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          displayFulfillmentStatus
          displayFinancialStatus
          customer {
            firstName
            lastName
            email
          }
          lineItems(first: 20) {
            edges {
              node {
                id
                title
                quantity
                product {
                  id
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function shopifyGidToLegacyId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}

// Real Shopify search syntax (https://shopify.dev/docs/api/usage/search-syntax) — a customer
// name/email/order-number search is delegated to Shopify's own index rather than reimplemented
// locally, since Shopify's Order resource is the actual source of truth, not a local mirror.
function buildOrderSearchQuery(search: string): string | undefined {
  const trimmed = search.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("#")) {
    return `name:${trimmed}`;
  }

  if (/^\d+$/.test(trimmed)) {
    return `name:#${trimmed}`;
  }

  if (trimmed.includes("@")) {
    return `email:${trimmed}`;
  }

  // Shopify's default (unscoped) search already matches against customer name, email, and
  // order name — this is intentionally broad rather than guessing which field the merchant
  // meant.
  return trimmed;
}

export async function searchShopifyOrders(
  admin: AdminApiContext,
  storeId: string,
  params: { search?: string; cursor?: string | null } = {},
): Promise<{ orders: ShopifyOrderSummary[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await adminGraphql<OrdersQueryResponse>(admin, ORDERS_QUERY, {
    first: ORDERS_PAGE_SIZE,
    after: params.cursor ?? undefined,
    query: buildOrderSearchQuery(params.search ?? ""),
  });

  const shopifyProductIds = new Set<string>();
  for (const edge of data.orders.edges) {
    for (const itemEdge of edge.node.lineItems.edges) {
      if (itemEdge.node.product?.id) {
        shopifyProductIds.add(itemEdge.node.product.id);
      }
    }
  }

  // One batched lookup against the local catalog rather than one query per line item — the
  // same n+1 avoidance every other list view in this codebase (e.g. review-request.server.ts's
  // listRequests) already follows.
  const localProducts = shopifyProductIds.size
    ? await prisma.product.findMany({
        where: { storeId, shopifyProductId: { in: Array.from(shopifyProductIds) } },
        select: { id: true, name: true, shopifyProductId: true },
      })
    : [];
  const localProductByShopifyId = new Map(localProducts.map((product) => [product.shopifyProductId, product]));

  const orders: ShopifyOrderSummary[] = data.orders.edges.map((edge) => {
    const node = edge.node;
    const customerName = node.customer
      ? [node.customer.firstName, node.customer.lastName].filter(Boolean).join(" ") || null
      : null;

    return {
      shopifyOrderId: shopifyGidToLegacyId(node.id),
      orderNumber: node.name,
      createdAt: node.createdAt,
      displayFulfillmentStatus: node.displayFulfillmentStatus,
      displayFinancialStatus: node.displayFinancialStatus,
      customerName,
      customerEmail: node.customer?.email ?? null,
      lineItems: node.lineItems.edges.map((itemEdge) => {
        const shopifyProductGid = itemEdge.node.product?.id ?? null;
        const localProduct = shopifyProductGid ? localProductByShopifyId.get(shopifyProductGid) : undefined;

        return {
          shopifyLineItemId: shopifyGidToLegacyId(itemEdge.node.id),
          title: itemEdge.node.title,
          quantity: itemEdge.node.quantity,
          shopifyProductId: shopifyProductGid ? shopifyGidToLegacyId(shopifyProductGid) : null,
          localProductId: localProduct?.id ?? null,
          localProductName: localProduct?.name ?? null,
        };
      }),
    };
  });

  return {
    orders,
    hasNextPage: data.orders.pageInfo.hasNextPage,
    endCursor: data.orders.pageInfo.endCursor,
  };
}
