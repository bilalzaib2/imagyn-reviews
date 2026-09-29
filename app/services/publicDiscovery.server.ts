import prisma from "../db.server";
import { Prisma, ReviewMediaType } from "@prisma/client";
import { ReviewStatus } from "./review.shared";

// The cross-store public read layer behind reviews.imagyn.co.
//
// This is deliberately SEPARATE from the api.reviews.* routes. Those are App-Proxy-signed and
// scoped to one shop — they serve a merchant's own storefront widgets. This layer serves the
// consumer network: it reads across every store, is unauthenticated, and is therefore the one
// place in the app where a field-exposure mistake becomes a public data leak.
//
// Three rules hold everywhere in this file, and nothing here should be changed without
// re-reading them:
//
//  1. ONLY published customer content. Every query filters `status: APPROVED` and
//     `deletedAt: null`. There is no parameter anywhere in this module that can widen that.
//  2. EXPLICIT field allow-lists. Every `select` names its fields; none uses `include` or
//     spreads a Prisma row into a response. Adding a column to the schema can therefore never
//     silently publish it.
//  3. NO merchant-private data, ever. Specifically never: reviewerEmail, reviewerLocation,
//     moderationStatus, moderationReason, externalId, importBatchId, sourceVerified, plan,
//     billing, settings, internal store ids, or anything from Session/AuditLog/ReviewRequest.
//
// On verification language: `verifiedPurchase` is IMAGYN's own signal and is the only thing
// this layer will ever call "verified". `importSource` is surfaced separately as provenance —
// an imported review is never represented as verified, per docs/IMPORT_VERIFICATION_POLICY.md.

// Development and test stores are never part of the public consumer network. This uses the
// Store.isDevelopmentStore flag the app already maintains — set from Shopify's own
// `shop.plan.partnerDevelopment` by billing.server.ts's ensureDevelopmentStoreFlag — rather
// than a slug blocklist, so it is based on real store identity and automatically covers every
// future dev store and Shopify App Review install without anyone remembering to add it.
//
// Deliberately `false`, not `NOT: true`: the column is nullable, and a store whose status has
// never been resolved is treated as not-yet-eligible rather than published by default. This
// fails closed — the cost of the strict reading is that a brand-new store joins discovery a
// few seconds later (the flag resolves on its first admin page load), and the cost of the
// loose reading would be a dev store leaking into the public network.
//
// This affects ONLY the public consumer surface. Merchant admin, storefront widgets, billing
// and every api.reviews.* route are untouched: a dev store's own dashboard and its own
// storefront work exactly as before.
// The two conditions a store must satisfy to exist on the public network at all. Every
// public read in this file funnels through this object (directly, or via
// DISCOVERABLE_REVIEW below), which is what makes the exclusion a database-level rule
// rather than something each consumer surface has to remember to apply.
//
//  - isDevelopmentStore: false  — a dev/test store is never public, and cannot make itself
//    public by flipping the merchant setting.
//  - publicNetworkEnabled: true — the merchant's own participation control. Turning it off
//    removes the store, its products and its reviews from every public surface, including
//    counts, facets, search, the sitemap and structured data, without touching a single
//    Review row.
const PUBLIC_STORE = {
  isDevelopmentStore: false,
  publicNetworkEnabled: true,
} satisfies Prisma.StoreWhereInput;

// A store only becomes part of the public network once it has at least one approved review.
// This is a real product rule, not a cosmetic filter: it keeps empty shops out of consumer
// discovery without anyone having to maintain a blocklist.
const DISCOVERABLE_REVIEW = {
  deletedAt: null,
  status: ReviewStatus.APPROVED,
  store: PUBLIC_STORE,
} satisfies Prisma.ReviewWhereInput;

export const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;

export type ReviewSort = "latest" | "helpful" | "highest" | "lowest";

export interface PublicReviewFilters {
  verifiedOnly?: boolean;
  withPhotos?: boolean;
  withVideo?: boolean;
  /** Exact star rating, 1-5. */
  rating?: number;
  /** Shopify productType, used as the category facet — the only real taxonomy that exists. */
  category?: string;
  /** Public store slug. */
  store?: string;
  /** Public product slug (see buildProductSlug). */
  product?: string;
  sort?: ReviewSort;
  cursor?: string | null;
  limit?: number;
}

// Products are store-scoped in this schema — there is no cross-store product identity (no
// GTIN/UPC), so two shops selling the same item are genuinely two different products. A bare
// Shopify handle is therefore NOT unique across the network and can't be the public URL.
// This appends a short, stable suffix from the product's own cuid: readable for SEO, unique by
// construction, and honest about the fact that a product here belongs to one store.
export function buildProductSlug(product: { id: string; handle: string | null; slug: string | null; name: string }): string {
  const base = (product.handle || product.slug || product.name || "product")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "product";
  return `${base}--${product.id.slice(-6)}`;
}

function productIdFromSlug(slug: string): string | null {
  const match = /--([a-z0-9]{6})$/.exec(slug.trim().toLowerCase());
  return match ? match[1] : null;
}

const REVIEW_SELECT = {
  id: true,
  rating: true,
  title: true,
  content: true,
  reviewerName: true,
  verifiedPurchase: true,
  helpfulCount: true,
  createdAt: true,
  reply: true,
  repliedAt: true,
  // Provenance only. Surfaced as "imported from X", never as a verification claim.
  importSource: true,
  media: {
    select: { id: true, type: true, url: true, thumbnailUrl: true, width: true, height: true },
    orderBy: { createdAt: "asc" as const },
  },
  product: {
    select: { id: true, name: true, handle: true, slug: true, featuredImage: true, productType: true, vendor: true },
  },
  store: { select: { name: true, slug: true } },
} satisfies Prisma.ReviewSelect;

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  verified: boolean;
  importedFrom: string | null;
  helpfulCount: number;
  createdAt: string;
  reply: { body: string; repliedAt: string | null } | null;
  media: Array<{ id: string; type: string; url: string; thumbnailUrl: string | null; width: number | null; height: number | null }>;
  product: { slug: string; name: string; image: string | null; category: string | null; brand: string | null };
  store: { slug: string; name: string };
}

/** Shopify writes productType/vendor as "" rather than null on plenty of products, so the raw
 *  column can't be trusted as "absent". Normalising here means every consumer branches on null
 *  only, and an empty category never renders as a blank chip or an empty facet. */
function orNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toPublicReview(row: ReviewRow): PublicReview {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    content: row.content,
    reviewerName: row.reviewerName,
    // IMAGYN's own verified-purchase signal, never a source platform's imported claim.
    verified: row.verifiedPurchase,
    importedFrom: row.importSource,
    helpfulCount: row.helpfulCount,
    createdAt: row.createdAt.toISOString(),
    reply: row.reply ? { body: row.reply, repliedAt: row.repliedAt?.toISOString() ?? null } : null,
    // Lowercased at the boundary: the enum is an internal storage detail, and a public API
    // contract of "image"/"video" is what consumers should code against.
    media: row.media.map((m) => ({ ...m, type: m.type.toLowerCase() })),
    product: {
      slug: buildProductSlug(row.product),
      name: row.product.name,
      image: row.product.featuredImage,
      category: orNull(row.product.productType),
      brand: orNull(row.product.vendor),
    },
    store: { slug: row.store.slug, name: row.store.name },
  };
}

function reviewOrderBy(sort: ReviewSort): Prisma.ReviewOrderByWithRelationInput[] {
  switch (sort) {
    case "helpful":
      return [{ helpfulCount: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "highest":
      return [{ rating: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    case "lowest":
      return [{ rating: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

async function resolveProductIdBySlug(slug: string): Promise<string | null> {
  const suffix = productIdFromSlug(slug);
  if (!suffix) return null;
  const product = await prisma.product.findFirst({
    where: { id: { endsWith: suffix }, store: PUBLIC_STORE },
    select: { id: true },
  });
  return product?.id ?? null;
}

async function buildReviewWhere(filters: PublicReviewFilters): Promise<Prisma.ReviewWhereInput> {
  const where: Prisma.ReviewWhereInput = { ...DISCOVERABLE_REVIEW };

  if (filters.verifiedOnly) where.verifiedPurchase = true;
  if (filters.rating && filters.rating >= 1 && filters.rating <= 5) where.rating = filters.rating;
  if (filters.withPhotos) where.media = { some: { type: ReviewMediaType.IMAGE } };
  if (filters.withVideo) where.media = { some: { type: ReviewMediaType.VIDEO } };
  // Merged, never replaced: assigning `where.store` outright would silently drop the
  // development-store and participation exclusions that DISCOVERABLE_REVIEW put there.
  if (filters.store) where.store = { ...PUBLIC_STORE, slug: filters.store };

  if (filters.category || filters.product) {
    const productWhere: Prisma.ProductWhereInput = {};
    if (filters.category) productWhere.productType = filters.category;
    if (filters.product) {
      const id = await resolveProductIdBySlug(filters.product);
      // An unresolvable slug must match nothing rather than silently widening to every product.
      productWhere.id = id ?? "__no_such_product__";
    }
    where.product = productWhere;
  }

  return where;
}

export interface PublicReviewPage {
  reviews: PublicReview[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export async function listPublicReviews(filters: PublicReviewFilters = {}): Promise<PublicReviewPage> {
  const limit = Math.min(Math.max(filters.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const where = await buildReviewWhere(filters);
  const sort = filters.sort ?? "latest";

  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: REVIEW_SELECT,
      orderBy: reviewOrderBy(sort),
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    reviews: page.map(toPublicReview),
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
    hasMore,
    total,
  };
}

export async function getPublicReview(id: string): Promise<PublicReview | null> {
  const row = await prisma.review.findFirst({
    where: { id, ...DISCOVERABLE_REVIEW },
    select: REVIEW_SELECT,
  });
  return row ? toPublicReview(row) : null;
}

// ---------------------------------------------------------------- Products

export interface PublicProductSummary {
  slug: string;
  name: string;
  image: string | null;
  category: string | null;
  brand: string | null;
  store: { slug: string; name: string };
  /** Counted from APPROVED reviews only — never Product.totalReviews, which counts every
   *  review regardless of moderation state and would overstate what a shopper can actually
   *  read on the page. */
  reviewCount: number;
  averageRating: number;
  verifiedCount: number;
}

const PRODUCT_SELECT = {
  id: true,
  name: true,
  handle: true,
  slug: true,
  featuredImage: true,
  productType: true,
  vendor: true,
  store: { select: { name: true, slug: true } },
} satisfies Prisma.ProductSelect;

// Products carrying real approved reviews, ranked by review depth. This is the ONLY product
// list the consumer network exposes: a product with no approved review has nothing for a
// shopper to read and is never presented as reviewed. The underlying catalogue keeps every
// product (958 at time of writing); discovery shows the reviewed ones.
export async function listReviewedProducts(options: { limit?: number; category?: string; store?: string } = {}): Promise<PublicProductSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? PAGE_SIZE, 1), MAX_PAGE_SIZE);

  const grouped = await prisma.review.groupBy({
    by: ["productId"],
    where: {
      ...DISCOVERABLE_REVIEW,
      ...(options.store ? { store: { slug: options.store } } : {}),
      ...(options.category ? { product: { productType: options.category } } : {}),
    },
    _count: { _all: true },
    _avg: { rating: true },
    orderBy: { _count: { productId: "desc" } },
    take: limit,
  });

  if (grouped.length === 0) return [];

  const productIds = grouped.map((g) => g.productId);
  const [products, verifiedCounts] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds }, store: PUBLIC_STORE }, select: PRODUCT_SELECT }),
    prisma.review.groupBy({
      by: ["productId"],
      where: { ...DISCOVERABLE_REVIEW, productId: { in: productIds }, verifiedPurchase: true },
      _count: { _all: true },
    }),
  ]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const verifiedById = new Map(verifiedCounts.map((v) => [v.productId, v._count._all]));

  return grouped
    .map((g) => {
      const product = byId.get(g.productId);
      if (!product) return null;
      return {
        slug: buildProductSlug(product),
        name: product.name,
        image: product.featuredImage,
        category: orNull(product.productType),
        brand: orNull(product.vendor),
        store: { slug: product.store.slug, name: product.store.name },
        reviewCount: g._count._all,
        averageRating: Number((g._avg.rating ?? 0).toFixed(1)),
        verifiedCount: verifiedById.get(g.productId) ?? 0,
      } satisfies PublicProductSummary;
    })
    .filter((p): p is PublicProductSummary => p !== null);
}

export interface PublicProductDetail extends PublicProductSummary {
  description: string | null;
  ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
  aiSummary: { summary: string; recommendation: string | null } | null;
}

export async function getPublicProduct(slug: string): Promise<PublicProductDetail | null> {
  const id = await resolveProductIdBySlug(slug);
  if (!id) return null;

  // Guarded independently of the review queries below: this reads the Product table directly,
  // so without it a dev store's product page would resolve even though its reviews wouldn't.
  const product = await prisma.product.findFirst({
    where: { id, store: PUBLIC_STORE },
    select: { ...PRODUCT_SELECT, description: true },
  });
  if (!product) return null;

  const [grouped, verified, aiSummary] = await Promise.all([
    prisma.review.groupBy({
      by: ["rating"],
      where: { ...DISCOVERABLE_REVIEW, productId: id },
      _count: { _all: true },
    }),
    prisma.review.count({ where: { ...DISCOVERABLE_REVIEW, productId: id, verifiedPurchase: true } }),
    // Pure cache read. Never triggers generation from a public request, and returns null when
    // the merchant has never generated one — the page renders without an AI section rather
    // than inventing copy.
    prisma.productAiSummary.findUnique({
      where: { productId: id },
      select: { summary: true, recommendation: true },
    }),
  ]);

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let total = 0;
  let weighted = 0;
  for (const g of grouped) {
    const star = g.rating as 1 | 2 | 3 | 4 | 5;
    if (star >= 1 && star <= 5) {
      counts[star] = g._count._all;
      total += g._count._all;
      weighted += star * g._count._all;
    }
  }

  return {
    slug: buildProductSlug(product),
    name: product.name,
    image: product.featuredImage,
    category: orNull(product.productType),
    brand: orNull(product.vendor),
    description: product.description,
    store: { slug: product.store.slug, name: product.store.name },
    reviewCount: total,
    averageRating: total > 0 ? Number((weighted / total).toFixed(1)) : 0,
    verifiedCount: verified,
    ratingCounts: counts,
    aiSummary: aiSummary ? { summary: aiSummary.summary, recommendation: aiSummary.recommendation } : null,
  };
}

// ---------------------------------------------------------------- Stores

export interface PublicStoreSummary {
  slug: string;
  name: string;
  reviewCount: number;
  averageRating: number;
  verifiedCount: number;
  productCount: number;
}

// Same rule as products: a store joins the public network by having approved reviews, which
// is what keeps the Shopify App Review test installs out of discovery automatically.
export async function listPublicStores(limit = PAGE_SIZE): Promise<PublicStoreSummary[]> {
  const grouped = await prisma.review.groupBy({
    by: ["storeId"],
    where: DISCOVERABLE_REVIEW,
    _count: { _all: true },
    _avg: { rating: true },
    orderBy: { _count: { storeId: "desc" } },
    take: Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
  });

  if (grouped.length === 0) return [];

  const storeIds = grouped.map((g) => g.storeId);
  const [stores, verifiedCounts, productCounts] = await Promise.all([
    prisma.store.findMany({ where: { id: { in: storeIds }, ...PUBLIC_STORE }, select: { id: true, name: true, slug: true } }),
    prisma.review.groupBy({
      by: ["storeId"],
      where: { ...DISCOVERABLE_REVIEW, storeId: { in: storeIds }, verifiedPurchase: true },
      _count: { _all: true },
    }),
    // Distinct reviewed products per store. groupBy's `_count: { productId: true }` counts
    // review ROWS with a non-null productId, not distinct products — which made every store
    // report its review count as its product count (58 reviews read as "58 products").
    prisma.review.findMany({
      where: { ...DISCOVERABLE_REVIEW, storeId: { in: storeIds } },
      select: { storeId: true, productId: true },
      distinct: ["storeId", "productId"],
    }),
  ]);

  const byId = new Map(stores.map((s) => [s.id, s]));
  const verifiedById = new Map(verifiedCounts.map((v) => [v.storeId, v._count._all]));
  const productsById = new Map<string, number>();
  for (const row of productCounts) {
    productsById.set(row.storeId, (productsById.get(row.storeId) ?? 0) + 1);
  }

  return grouped
    .map((g) => {
      const store = byId.get(g.storeId);
      if (!store) return null;
      return {
        slug: store.slug,
        name: store.name,
        reviewCount: g._count._all,
        averageRating: Number((g._avg.rating ?? 0).toFixed(1)),
        verifiedCount: verifiedById.get(g.storeId) ?? 0,
        productCount: productsById.get(g.storeId) ?? 0,
      } satisfies PublicStoreSummary;
    })
    .filter((s): s is PublicStoreSummary => s !== null);
}

export interface PublicStoreDetail extends PublicStoreSummary {
  ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
  aiSummary: { summary: string; reviewCountUsed: number } | null;
}

export async function getPublicStore(slug: string): Promise<PublicStoreDetail | null> {
  const store = await prisma.store.findFirst({
    where: { slug, ...PUBLIC_STORE },
    // Deliberately narrow: this row carries plan, billing ids, API-ish settings and every
    // merchant preference. Only name and slug may cross into public data.
    select: { id: true, name: true, slug: true, aiSummaryOnReviewSiteEnabled: true },
  });
  if (!store) return null;

  const [grouped, verified, productCount, aiSummary] = await Promise.all([
    prisma.review.groupBy({
      by: ["rating"],
      where: { ...DISCOVERABLE_REVIEW, storeId: store.id },
      _count: { _all: true },
    }),
    prisma.review.count({ where: { ...DISCOVERABLE_REVIEW, storeId: store.id, verifiedPurchase: true } }),
    prisma.review.findMany({
      where: { ...DISCOVERABLE_REVIEW, storeId: store.id },
      select: { productId: true },
      distinct: ["productId"],
    }),
    store.aiSummaryOnReviewSiteEnabled
      ? prisma.storeAiSummary.findUnique({ where: { storeId: store.id }, select: { summary: true, reviewCountUsed: true } })
      : Promise.resolve(null),
  ]);

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let total = 0;
  let weighted = 0;
  for (const g of grouped) {
    const star = g.rating as 1 | 2 | 3 | 4 | 5;
    if (star >= 1 && star <= 5) {
      counts[star] = g._count._all;
      total += g._count._all;
      weighted += star * g._count._all;
    }
  }

  // A store with no approved reviews is not part of the public network.
  if (total === 0) return null;

  return {
    slug: store.slug,
    name: store.name,
    reviewCount: total,
    averageRating: Number((weighted / total).toFixed(1)),
    verifiedCount: verified,
    productCount: productCount.length,
    ratingCounts: counts,
    aiSummary,
  };
}

// ---------------------------------------------------------------- Network stats & facets

export interface NetworkStats {
  reviews: number;
  verifiedReviews: number;
  reviewsWithMedia: number;
  reviewedProducts: number;
  stores: number;
  categories: number;
}

// Powers the homepage's discovery statement. Every number is counted live from approved
// content, so the copy is true at whatever size the network happens to be — 17 products today,
// and the same sentence still reads correctly at 17,000.
export async function getNetworkStats(): Promise<NetworkStats> {
  const [reviews, verifiedReviews, withMedia, reviewedProducts, stores, categories] = await Promise.all([
    prisma.review.count({ where: DISCOVERABLE_REVIEW }),
    prisma.review.count({ where: { ...DISCOVERABLE_REVIEW, verifiedPurchase: true } }),
    prisma.review.count({ where: { ...DISCOVERABLE_REVIEW, media: { some: {} } } }),
    prisma.review.findMany({ where: DISCOVERABLE_REVIEW, select: { productId: true }, distinct: ["productId"] }),
    prisma.review.findMany({ where: DISCOVERABLE_REVIEW, select: { storeId: true }, distinct: ["storeId"] }),
    prisma.review.findMany({
      where: { ...DISCOVERABLE_REVIEW, product: { productType: { not: null } } },
      select: { product: { select: { productType: true } } },
      distinct: ["productId"],
    }),
  ]);

  return {
    reviews,
    verifiedReviews,
    reviewsWithMedia: withMedia,
    reviewedProducts: reviewedProducts.length,
    stores: stores.length,
    categories: new Set(categories.map((c) => c.product.productType).filter(Boolean)).size,
  };
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

// Only facets that actually have approved content behind them are returned, so the UI never
// renders a filter that leads to an empty result set — the failure mode that makes a small
// network look broken.
export async function getDiscoveryFacets(): Promise<{ categories: Facet[]; stores: Facet[] }> {
  const rows = await prisma.review.findMany({
    where: DISCOVERABLE_REVIEW,
    select: { product: { select: { productType: true } }, store: { select: { name: true, slug: true } } },
  });

  const categoryCounts = new Map<string, number>();
  const storeCounts = new Map<string, { label: string; count: number }>();

  for (const row of rows) {
    const category = row.product.productType?.trim();
    if (category) categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);

    const existing = storeCounts.get(row.store.slug);
    storeCounts.set(row.store.slug, { label: row.store.name, count: (existing?.count ?? 0) + 1 });
  }

  return {
    categories: [...categoryCounts.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count),
    stores: [...storeCounts.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------- Search

export interface SearchResults {
  products: PublicProductSummary[];
  stores: PublicStoreSummary[];
  reviews: PublicReview[];
}

// One query across the three public entities. Deliberately simple `contains` matching rather
// than full-text: at this network size it is correct and instant, and swapping in Postgres FTS
// later changes only this function.
export async function searchPublic(query: string, limit = 8): Promise<SearchResults> {
  const q = query.trim();
  if (q.length < 2) return { products: [], stores: [], reviews: [] };

  const contains = { contains: q, mode: "insensitive" as const };

  const [productIds, storeSlugs, reviewRows] = await Promise.all([
    prisma.review.findMany({
      where: { ...DISCOVERABLE_REVIEW, product: { OR: [{ name: contains }, { vendor: contains }, { productType: contains }] } },
      select: { productId: true },
      distinct: ["productId"],
      take: limit,
    }),
    prisma.review.findMany({
      where: { ...DISCOVERABLE_REVIEW, store: { name: contains } },
      select: { store: { select: { slug: true } } },
      distinct: ["storeId"],
      take: limit,
    }),
    prisma.review.findMany({
      where: { ...DISCOVERABLE_REVIEW, OR: [{ title: contains }, { content: contains }] },
      select: REVIEW_SELECT,
      orderBy: [{ helpfulCount: "desc" }, { createdAt: "desc" }],
      take: limit,
    }),
  ]);

  const [products, stores] = await Promise.all([
    productIds.length > 0 ? hydrateProducts(productIds.map((p) => p.productId)) : Promise.resolve([]),
    Promise.all(storeSlugs.map((s) => getPublicStore(s.store.slug))).then((list) =>
      list.filter((s): s is PublicStoreDetail => s !== null),
    ),
  ]);

  return { products, stores, reviews: reviewRows.map(toPublicReview) };
}

async function hydrateProducts(ids: string[]): Promise<PublicProductSummary[]> {
  const [products, grouped, verified] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids }, store: PUBLIC_STORE }, select: PRODUCT_SELECT }),
    prisma.review.groupBy({
      by: ["productId"],
      where: { ...DISCOVERABLE_REVIEW, productId: { in: ids } },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    prisma.review.groupBy({
      by: ["productId"],
      where: { ...DISCOVERABLE_REVIEW, productId: { in: ids }, verifiedPurchase: true },
      _count: { _all: true },
    }),
  ]);

  const statsById = new Map(grouped.map((g) => [g.productId, g]));
  const verifiedById = new Map(verified.map((v) => [v.productId, v._count._all]));

  return products.map((product) => {
    const stats = statsById.get(product.id);
    return {
      slug: buildProductSlug(product),
      name: product.name,
      image: product.featuredImage,
      category: orNull(product.productType),
      brand: orNull(product.vendor),
      store: { slug: product.store.slug, name: product.store.name },
      reviewCount: stats?._count._all ?? 0,
      averageRating: Number((stats?._avg.rating ?? 0).toFixed(1)),
      verifiedCount: verifiedById.get(product.id) ?? 0,
    };
  });
}
