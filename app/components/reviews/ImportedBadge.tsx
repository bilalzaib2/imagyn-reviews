import { Badge } from "@shopify/polaris";

// Real, source-derived signal — set only when Review.externalId is non-null (see that
// field's own comment in schema.prisma), i.e. this review came in through the CSV/platform
// importer, never a customer-facing submission. Never inferred any other way.
export function ImportedBadge() {
  return <Badge tone="new">Imported</Badge>;
}
