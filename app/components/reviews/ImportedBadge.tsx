import { StatusBadge } from "../ui/StatusBadge";

// Real, source-derived signal — set only when Review.externalId is non-null (see that
// field's own comment in schema.prisma), i.e. this review came in through the CSV/platform
// importer, never a customer-facing submission. Never inferred any other way.
//
// `neutral`: provenance is a plain fact with no valence. An imported review is neither
// better nor worse than a submitted one, and colouring it would imply otherwise.
export function ImportedBadge() {
  return <StatusBadge tone="neutral">Imported</StatusBadge>;
}
