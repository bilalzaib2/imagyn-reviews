import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Prisma, Product } from "@prisma/client";
import prisma from "../db.server";

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  description: string | null;
  featuredImage: { url: string } | null;
}

// Shopify's own hard ceiling on `first` for this connection — not a business choice, so it's
// the one "limit" that's correct to keep. Pagination via pageInfo/endCursor below is what
// makes catalog size otherwise unbounded: this constant controls request count, not how many
// products get synced.
const PRODUCTS_PAGE_SIZE = 250;

// Bounded retry for Shopify's cost-based GraphQL throttling — a catalog large enough to need
// hundreds of pages will hit THROTTLED responses in normal operation, not as a rare edge case,
// so retrying is part of normal pagination, not error handling bolted on afterward.
const MAX_THROTTLE_RETRIES = 6;
const FALLBACK_THROTTLE_WAIT_MS = 2000;

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { requestedQueryCost: number; throttleStatus?: ThrottleStatus } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isThrottled(errors: GraphqlEnvelope<unknown>["errors"]): boolean {
  return Boolean(errors?.some((error) => error.extensions?.code === "THROTTLED"));
}

// Waits long enough to comfortably afford the next request rather than the bare minimum — if
// currentlyAvailable already covers a full page's cost, this is a no-op.
async function waitForThrottleBudget(throttleStatus: ThrottleStatus | undefined, neededPoints: number) {
  if (!throttleStatus) return;
  const deficit = neededPoints - throttleStatus.currentlyAvailable;
  if (deficit <= 0) return;

  const waitMs = Math.ceil((deficit / throttleStatus.restoreRate) * 1000);
  await sleep(Math.max(waitMs, 500));
}

// Every Shopify Admin GraphQL call in this file goes through here rather than admin.graphql()
// directly, so pagination self-paces against Shopify's cost budget instead of just retrying
// blindly after getting throttled — for a 100k-product catalog (400 pages), the difference is
// a sync that completes steadily vs. one that spends most of its time in backoff.
async function graphqlWithThrottleHandling<T>(
  admin: AdminApiContext,
  query: string,
  variables: Record<string, unknown> | undefined,
  estimatedCost: number,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_THROTTLE_RETRIES; attempt++) {
    const response = await admin.graphql(query, variables ? { variables } : undefined);
    const json = (await response.json()) as GraphqlEnvelope<T>;
    const throttleStatus = json.extensions?.cost?.throttleStatus;

    if (isThrottled(json.errors)) {
      if (attempt === MAX_THROTTLE_RETRIES) {
        throw new Error("Shopify API rate limit exceeded — too many throttled retries during product sync.");
      }
      if (throttleStatus) {
        await waitForThrottleBudget(throttleStatus, estimatedCost);
      } else {
        await sleep(FALLBACK_THROTTLE_WAIT_MS);
      }
      continue;
    }

    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors.map((error) => error.message).join(" "));
    }

    if (!json.data) {
      throw new Error("Shopify did not return any data.");
    }

    // Pace the *next* call proactively — waiting until we get throttled and retrying is
    // strictly slower than just not sending a request we already know will be rejected.
    if (throttleStatus && throttleStatus.currentlyAvailable < estimatedCost) {
      await waitForThrottleBudget(throttleStatus, estimatedCost);
    }

    return json.data;
  }

  throw new Error("Shopify API rate limit exceeded — too many throttled retries during product sync.");
}

const PRODUCTS_COUNT_QUERY = `#graphql
  query ImagynProductsCount {
    productsCount {
      count
    }
  }
`;

// Informational only — Shopify itself may report this as an approximation once a catalog
// passes roughly 10k products (see the API's own `precision` field on CountResult, which this
// intentionally doesn't surface further than "best effort"). The pagination loop below never
// relies on this number to decide when it's done; only `hasNextPage` does that. A merchant
// sees this as the progress bar's denominator, never as a completion condition.
export async function getShopifyProductCount(admin: AdminApiContext): Promise<number | null> {
  try {
    const data = await graphqlWithThrottleHandling<{ productsCount?: { count?: number } }>(
      admin,
      PRODUCTS_COUNT_QUERY,
      undefined,
      1,
    );
    return data.productsCount?.count ?? null;
  } catch (error) {
    console.error("[productSync] Unable to fetch Shopify product count:", error);
    return null;
  }
}

const PRODUCTS_PAGE_QUERY = `#graphql
  query ImagynProductsPage($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        vendor
        productType
        status
        description
        featuredImage {
          url
        }
      }
    }
  }
`;

interface ProductsPageResponse {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
}

async function upsertShopifyProduct(storeId: string, product: ShopifyProductNode): Promise<boolean> {
  if (!product.id) {
    return false;
  }

  try {
    await prisma.product.upsert({
      where: {
        shopifyProductId: product.id,
      },
      update: {
        storeId,
        name: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        status: product.status,
        featuredImage: product.featuredImage?.url ?? null,
        description: product.description,
        slug: product.handle,
        lastSyncedAt: new Date(),
      },
      create: {
        storeId,
        shopifyProductId: product.id,
        name: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        status: product.status,
        featuredImage: product.featuredImage?.url ?? null,
        description: product.description,
        slug: product.handle,
        lastSyncedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    console.error(`Failed to sync Shopify product ${product.id}:`, error);
    return false;
  }
}

export interface ProductSyncProgress {
  synced: number;
  failed: number;
  total: number | null;
}

// Pages through the ENTIRE catalog via cursor pagination — no page-count cap, no product-count
// cap; the loop's only exit condition is Shopify's own `hasNextPage`. Upserts each page as it
// arrives rather than accumulating the full catalog in memory first, so this scales the same
// way at 100 products or 100,000. `onProgress` fires after every page (not every product) —
// frequent enough for a live progress bar, infrequent enough not to hammer the DB once per
// product on a huge catalog.
export async function syncAllProducts(
  admin: AdminApiContext,
  storeId: string,
  onProgress: (progress: ProductSyncProgress) => Promise<void> | void,
): Promise<ProductSyncProgress> {
  const total = await getShopifyProductCount(admin);
  let synced = 0;
  let failed = 0;
  await onProgress({ synced, failed, total });

  let after: string | null = null;
  let hasNextPage = true;

  // Empirically ~1-2 cost points per product node at this field selection (id/title/handle/
  // vendor/productType/status/description/featuredImage — all scalar/single-object, no
  // further connections) — 250 * 2 is a deliberately generous estimate for the throttle
  // pacing above, not a real Shopify-published constant.
  const estimatedPageCost = PRODUCTS_PAGE_SIZE * 2;

  while (hasNextPage) {
    const data: ProductsPageResponse = await graphqlWithThrottleHandling<ProductsPageResponse>(
      admin,
      PRODUCTS_PAGE_QUERY,
      { first: PRODUCTS_PAGE_SIZE, after },
      estimatedPageCost,
    );

    for (const node of data.products.nodes) {
      const ok = await upsertShopifyProduct(storeId, node);
      if (ok) {
        synced += 1;
      } else {
        failed += 1;
      }
    }

    hasNextPage = data.products.pageInfo.hasNextPage;
    after = data.products.pageInfo.endCursor;

    await onProgress({ synced, failed, total });
  }

  return { synced, failed, total };
}

// Unbounded on purpose — every existing caller (the manual-review product picker on
// app.reviews_.new.tsx/app.reviews_.$id.edit.tsx, and productMatcher.server.ts's Judge.me
// import matching, which needs the *entire* catalog loaded once to build its in-memory
// lookup maps) genuinely needs the full list, not a page of it. Do not add pagination here —
// see getProductsPage below for the Products admin page's own, separate, paginated query.
export async function getProducts(storeId: string) {
  return prisma.product.findMany({
    where: {
      storeId,
    },
    orderBy: {
      name: "asc",
    },
  });
}

export interface ProductQueryOptions {
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface ProductQueryResult {
  products: Product[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

// The Products admin page's own query — same cursor-pagination shape as review.server.ts's
// queryReviews (real DB LIMIT via `take`, a real COUNT query for totalCount, `id` as a stable
// tiebreak so cursor pagination can't skip or duplicate rows when two products share a sort
// key). Deliberately a separate function from getProducts above rather than a shared one with
// an optional pagination flag — the existing unbounded callers must never accidentally start
// receiving a truncated list because a default changed underneath them.
export async function getProductsPage(storeId: string, options: ProductQueryOptions = {}): Promise<ProductQueryResult> {
  const limit = options.limit ?? 25;

  const where: Prisma.ProductWhereInput = {
    storeId,
    ...(options.search
      ? {
          OR: [
            { name: { contains: options.search } },
            { handle: { contains: options.search } },
            { vendor: { contains: options.search } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [{ name: "asc" }, { id: "asc" }];

  const [totalCount, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = products.length > limit;
  const pagedProducts = hasMore ? products.slice(0, limit) : products;

  return {
    products: pagedProducts,
    nextCursor: hasMore && pagedProducts.length > 0 ? pagedProducts[pagedProducts.length - 1].id : null,
    hasMore,
    totalCount,
  };
}

export async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: {
      id,
    },
  });
}

export async function getProductForStore(id: string, storeId: string) {
  return prisma.product.findFirst({
    where: {
      id,
      storeId,
    },
  });
}

// `shopifyProductId` is stored in GraphQL GID form (set from the Admin GraphQL API in
// syncAllProducts above), but callers on the storefront side — and review-import sources like
// Judge.me, which export the bare numeric id — only ever have Shopify's bare numeric id (e.g.
// Liquid's `product.id`), so it's normalized to GID form before lookup. Exported for reuse by
// importers/productMatcher.server.ts rather than re-implementing GID normalization there.
export function toProductGid(shopifyProductId: string): string {
  const trimmed = shopifyProductId.trim();
  return trimmed.startsWith("gid://") ? trimmed : `gid://shopify/Product/${trimmed}`;
}

// For callers that only have Shopify's own product identifier (e.g. Liquid's `product.id`)
// rather than our internal cuid `Product.id`.
export async function getProductForStoreByShopifyId(shopifyProductId: string, storeId: string) {
  return prisma.product.findFirst({
    where: {
      shopifyProductId: toProductGid(shopifyProductId),
      storeId,
    },
  });
}

const PRODUCT_BY_ID_QUERY = `#graphql
  query ImagynProductById($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      vendor
      productType
      status
      description
      featuredImage {
        url
      }
    }
  }
`;

interface ProductByIdResponse {
  product: ShopifyProductNode | null;
}

// Single-product counterpart of PRODUCTS_PAGE_QUERY above — used only by the storefront's
// lazy fallback below (syncSingleProductIfExists), never by the full-catalog sync, which
// stays entirely on its own cursor pagination. A lone product lookup doesn't need the page
// query's throttle budgeting to matter much, but goes through the same
// graphqlWithThrottleHandling as everything else in this file rather than a bespoke fetch.
async function fetchShopifyProductById(admin: AdminApiContext, shopifyProductGid: string): Promise<ShopifyProductNode | null> {
  const data = await graphqlWithThrottleHandling<ProductByIdResponse>(admin, PRODUCT_BY_ID_QUERY, { id: shopifyProductGid }, 2);
  return data.product ?? null;
}

// The storefront (app/routes/api.reviews.tsx) 404s a product that's a real, valid Shopify
// product but hasn't been through a full-catalog sync yet (syncAllProducts) — either because
// that merchant never ran one, or ran it before this product existed in their catalog. Rather
// than leaving the widget broken until someone happens to notice and re-run the full sync,
// this resolves just the one product actually being requested, on demand — through the exact
// same upsertShopifyProduct the full sync already uses, so there remains exactly one code
// path that ever writes a Product row from Shopify data. Returns null, writing nothing at
// all, when Shopify itself has no such product (an invalid/foreign id) — this never creates a
// row for a product that doesn't genuinely exist on the shop.
async function syncSingleProductIfExists(admin: AdminApiContext, storeId: string, shopifyProductId: string): Promise<Product | null> {
  const gid = toProductGid(shopifyProductId);
  const node = await fetchShopifyProductById(admin, gid);

  if (!node) {
    return null;
  }

  const upserted = await upsertShopifyProduct(storeId, node);
  if (!upserted) {
    return null;
  }

  return getProductForStoreByShopifyId(shopifyProductId, storeId);
}

// Storefront-facing lookup used by api.reviews.tsx in place of a bare
// getProductForStoreByShopifyId call. The fast path — a product that's already synced — is
// identical to calling getProductForStoreByShopifyId directly: one DB read, no Shopify API
// call. Only a genuine cache miss falls through to syncSingleProductIfExists above. `admin`
// is whatever the caller's own App Proxy authentication already resolved (undefined only if
// that shop genuinely has no session) — this degrades to the same null/"not found" result the
// caller already handles today, rather than throwing.
export async function getOrSyncProductForStoreByShopifyId(
  shopifyProductId: string,
  storeId: string,
  admin: AdminApiContext | undefined,
): Promise<Product | null> {
  const existing = await getProductForStoreByShopifyId(shopifyProductId, storeId);
  if (existing) {
    return existing;
  }

  if (!admin) {
    return null;
  }

  try {
    return await syncSingleProductIfExists(admin, storeId, shopifyProductId);
  } catch (error) {
    console.error(`[productSync] Lazy single-product lookup failed for ${shopifyProductId} (store ${storeId}):`, error);
    return null;
  }
}

// Batched counterpart of getProductForStoreByShopifyId, for scanning many product cards at
// once (collection grids, search results) without one query per product. Accepts a mix of
// Shopify product ids and/or handles, since theme card markup exposes one or the other
// depending on the theme — a single query resolves both.
export async function getProductsForStoreByIdentifiers(
  storeId: string,
  identifiers: { shopifyProductIds: string[]; handles: string[] },
) {
  const gids = identifiers.shopifyProductIds.map(toProductGid);

  if (gids.length === 0 && identifiers.handles.length === 0) {
    return [];
  }

  return prisma.product.findMany({
    where: {
      storeId,
      OR: [
        ...(gids.length > 0 ? [{ shopifyProductId: { in: gids } }] : []),
        ...(identifiers.handles.length > 0 ? [{ handle: { in: identifiers.handles } }] : []),
      ],
    },
    select: {
      id: true,
      shopifyProductId: true,
      handle: true,
    },
  });
}

type ProductIdentifierRow = Awaited<ReturnType<typeof getProductsForStoreByIdentifiers>>[number];

const PRODUCT_BY_HANDLE_QUERY = `#graphql
  query ImagynProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      vendor
      productType
      status
      description
      featuredImage {
        url
      }
    }
  }
`;

interface ProductByHandleResponse {
  productByHandle: ShopifyProductNode | null;
}

// Handle counterpart of fetchShopifyProductById — needed because the Collection Ratings
// batch caller (collection-rating-badges.js's theme-agnostic fallback) only ever has a
// product handle, scraped from a /products/{handle} link, never Shopify's numeric id.
async function fetchShopifyProductByHandle(admin: AdminApiContext, handle: string): Promise<ShopifyProductNode | null> {
  const data = await graphqlWithThrottleHandling<ProductByHandleResponse>(admin, PRODUCT_BY_HANDLE_QUERY, { handle }, 2);
  return data.productByHandle ?? null;
}

// Handle counterpart of syncSingleProductIfExists — same upsertShopifyProduct, same
// "write nothing for a handle Shopify doesn't recognize" guarantee, just entered by handle
// instead of id. node.id from the handle lookup is already a real Shopify GID, so the
// post-upsert re-read reuses getProductForStoreByShopifyId exactly like the id-based path.
async function syncSingleProductByHandleIfExists(admin: AdminApiContext, storeId: string, handle: string): Promise<Product | null> {
  const node = await fetchShopifyProductByHandle(admin, handle);
  if (!node) {
    return null;
  }

  const upserted = await upsertShopifyProduct(storeId, node);
  if (!upserted) {
    return null;
  }

  return getProductForStoreByShopifyId(node.id, storeId);
}

// A collection page can legitimately ask about up to MAX_IDENTIFIERS (100, see
// api.reviews.batch.tsx) products in one request. Only bounding concern here: a store that
// has genuinely never been synced could otherwise turn one page load into 100 sequential
// Shopify lookups. Capped low and run in parallel — this only ever needs to cover the
// occasional never-synced straggler, not a cold-start full catalog (the full sync and the
// single-product lazy fallback both already exist for that).
const MAX_LAZY_SYNC_PER_BATCH = 12;

// Batch-request counterpart of getOrSyncProductForStoreByShopifyId. The fast path — every
// requested product already synced — is identical to getProductsForStoreByIdentifiers: one
// DB read, no Shopify API calls. Only identifiers with no local match fall through to a
// bounded set of per-item lazy lookups (by id or by handle, matching how each identifier was
// supplied), reusing the exact same single-product resolvers above — no separate upsert path.
export async function getOrSyncProductsForStoreByIdentifiers(
  storeId: string,
  identifiers: { shopifyProductIds: string[]; handles: string[] },
  admin: AdminApiContext | undefined,
): Promise<ProductIdentifierRow[]> {
  const existing = await getProductsForStoreByIdentifiers(storeId, identifiers);

  if (!admin) {
    return existing;
  }

  const resolvedGids = new Set(existing.map((product) => product.shopifyProductId).filter((id): id is string => Boolean(id)));
  const resolvedHandles = new Set(existing.map((product) => product.handle).filter((handle): handle is string => Boolean(handle)));

  const missingIds = identifiers.shopifyProductIds.filter((id) => !resolvedGids.has(toProductGid(id)));
  const missingHandles = identifiers.handles.filter((handle) => !resolvedHandles.has(handle));

  const missing = [
    ...missingIds.map((value) => ({ kind: "id" as const, value })),
    ...missingHandles.map((value) => ({ kind: "handle" as const, value })),
  ].slice(0, MAX_LAZY_SYNC_PER_BATCH);

  if (missing.length === 0) {
    return existing;
  }

  const resolved = await Promise.all(
    missing.map((entry) => {
      const lookup =
        entry.kind === "id"
          ? syncSingleProductIfExists(admin, storeId, entry.value)
          : syncSingleProductByHandleIfExists(admin, storeId, entry.value);

      return lookup.catch((error) => {
        console.error(`[productSync] Lazy batch lookup failed for ${entry.kind} ${entry.value} (store ${storeId}):`, error);
        return null;
      });
    }),
  );

  const newlyResolved: ProductIdentifierRow[] = resolved
    .filter((product): product is Product => product !== null)
    .map((product) => ({ id: product.id, shopifyProductId: product.shopifyProductId, handle: product.handle }));

  return existing.concat(newlyResolved);
}

export type { Product };
