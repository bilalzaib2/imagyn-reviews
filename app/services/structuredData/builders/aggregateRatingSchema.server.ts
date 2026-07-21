// Imagyn Reviews — AggregateRating schema.org node builder.
//
// Google requires ratingValue + reviewCount (no documented minimum count) — see
// developers.google.com/search/docs/appearance/structured-data/product-snippet.
// Callers (index.server.ts) only invoke this once totalReviews > 0; this builder itself
// doesn't re-check that, since it has no way to fail gracefully on its own (it always
// returns a valid node) — the zero-review guard belongs to the composer, not here.

import type { JsonLdNode } from "../types.server";

export interface AggregateRatingSchemaInput {
  ratingValue: number;
  reviewCount: number;
}

export function buildAggregateRatingSchema(input: AggregateRatingSchemaInput): JsonLdNode {
  return {
    "@type": "AggregateRating",
    ratingValue: input.ratingValue,
    reviewCount: input.reviewCount,
    bestRating: 5,
    worstRating: 1,
  };
}
