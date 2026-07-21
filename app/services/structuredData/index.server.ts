// Imagyn Reviews — structured-data composer.
//
// The reusable engine: takes plain data (never a Prisma object beyond the typed
// ReviewWithProduct shape, never a Liquid object, never an admin GraphQL client) and
// returns a plain JSON-LD node or null. This is what makes the engine reusable outside
// the current Shopify-metafield delivery mechanism (see sync.server.ts) — a future public
// platform page can call buildProductStructuredData directly from its own loader and
// inline the result itself, with no metafield and no Admin API involved.
//
// Extension points for future schema types (Organization, Breadcrumb, FAQ — see
// docs note in sync.server.ts): add a new builders/*.server.ts file exporting one pure
// build function, then either extend this composer (if it's still Product-scoped) or add
// a sibling composer + wrapAsGraph the results together. No existing builder changes.

import { buildProductSchema } from "./builders/productSchema.server";
import { buildAggregateRatingSchema } from "./builders/aggregateRatingSchema.server";
import { buildReviewSchema, selectReviewsForSchema } from "./builders/reviewSchema.server";
import type { JsonLdNode } from "./types.server";
import type { PublicReviewSummary, ReviewWithProduct } from "../review.server";

// Google documents no minimum review count for AggregateRating — named constant so a
// future minimum (if ever desired) is a one-line change, not a hunt through this file.
const MIN_REVIEWS_FOR_AGGREGATE = 1;

export interface ProductStructuredDataInput {
  name: string;
  featuredImage: string | null;
}

// Returns null whenever there isn't enough real data to satisfy Google's requirement
// that a Product node carry at least one of review/aggregateRating/offers (this app never
// sets offers) — callers must treat null as "render nothing," not "render an empty node."
export function buildProductStructuredData(
  product: ProductStructuredDataInput,
  summary: PublicReviewSummary,
  reviews: ReviewWithProduct[],
): JsonLdNode | null {
  if (!product.name?.trim()) {
    return null;
  }

  const node = buildProductSchema({ name: product.name, image: product.featuredImage });

  if (summary.totalReviews >= MIN_REVIEWS_FOR_AGGREGATE) {
    node.aggregateRating = buildAggregateRatingSchema({
      ratingValue: summary.averageRating,
      reviewCount: summary.totalReviews,
    });
  }

  const selectedReviews = selectReviewsForSchema(reviews);
  if (selectedReviews.length > 0) {
    node.review = selectedReviews.map(buildReviewSchema);
  }

  if (!node.aggregateRating && !node.review) {
    return null;
  }

  return node;
}

// Reserved for future multi-node pages (e.g. a public platform page bundling Product +
// BreadcrumbList): Google's documented mechanism for multiple related entities in one
// <script type="application/ld+json"> tag. Not called anywhere yet — this pass only ever
// emits a single Product node — but the seam exists now so adding a second node later
// doesn't require restructuring how documents are assembled.
export function wrapAsGraph(nodes: JsonLdNode[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
