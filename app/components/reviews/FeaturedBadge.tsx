import { Badge } from "@shopify/polaris";

// Real, merchant-curated signal — set only when Review.featured is true (see
// review.server.ts's getFeaturedReviews for the one place this flag is actually read for
// the storefront carousel). Never inferred from rating/status.
export function FeaturedBadge() {
  return <Badge tone="attention">Featured</Badge>;
}
