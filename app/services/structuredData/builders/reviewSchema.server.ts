// Imagyn Reviews — Review schema.org node builder.
//
// Every field here maps to a real column on an already-APPROVED, already-public
// ReviewWithProduct row (see review.server.ts) — nothing is fabricated. `name`/`image`
// are only set when the underlying data actually exists (title, ReviewMedia rows), per
// the "never generate fake data" requirement.

import type { ReviewWithProduct } from "../../review.server";
import type { JsonLdNode } from "../types.server";

// Google doesn't want every review embedded in a Product node's markup — this caps how
// many ride along. Also used by sync.server.ts as the query limit, so the DB never
// fetches more rows than could ever be used.
export const MAX_REVIEWS_IN_SCHEMA = 10;

// Reserved seam for a future selection strategy (e.g. weighting by helpfulness). Callers
// already query APPROVED-only, newest-first, capped at MAX_REVIEWS_IN_SCHEMA (see
// review.server.ts's default sort), so this is a pass-through today, not dead code —
// changing the strategy later means editing this one function, not any caller.
export function selectReviewsForSchema(reviews: ReviewWithProduct[]): ReviewWithProduct[] {
  return reviews.slice(0, MAX_REVIEWS_IN_SCHEMA);
}

export function buildReviewSchema(review: ReviewWithProduct): JsonLdNode {
  const node: JsonLdNode = {
    "@type": "Review",
    author: { "@type": "Person", name: review.reviewerName },
    reviewRating: {
      "@type": "Rating",
      ratingValue: review.rating,
      bestRating: 5,
      worstRating: 1,
    },
    datePublished: review.createdAt.toISOString(),
    reviewBody: review.content,
  };

  if (review.title) {
    node.name = review.title;
  }

  if (review.media.length > 0) {
    node.image = review.media.map((item) => item.url);
  }

  return node;
}
