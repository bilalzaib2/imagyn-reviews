import { StatusBadge } from "../ui/StatusBadge";

// Real, merchant-curated signal — set only when Review.featured is true (see
// review.server.ts's getFeaturedReviews for the one place this flag is actually read for
// the storefront carousel). Never inferred from rating/status.
//
// `brand`, not `warning`: this used to be a Polaris Badge with tone="attention", which
// renders amber and reads as "something is wrong here". Featuring a review is a deliberate
// act of curation, which is exactly what the brand accent is for — and it matches the
// Featured meta signal the Reviews table already renders in the same green.
export function FeaturedBadge() {
  return <StatusBadge tone="brand">Featured</StatusBadge>;
}
