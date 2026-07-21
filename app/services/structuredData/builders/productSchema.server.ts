// Imagyn Reviews — Product schema.org node builder.
//
// Deliberately minimal: this app doesn't own price/availability (no `offers`), so it
// never fabricates one. index.server.ts's composer is responsible for ensuring the
// resulting node always carries at least one of review/aggregateRating/offers — Google
// requires one of the three on every Product node — since this builder alone can't
// guarantee that (it runs before review/aggregateRating are attached).

import type { JsonLdNode } from "../types.server";

export interface ProductSchemaInput {
  name: string;
  image: string | null;
}

export function buildProductSchema(product: ProductSchemaInput): JsonLdNode {
  const node: JsonLdNode = {
    "@type": "Product",
    name: product.name,
  };

  if (product.image) {
    node.image = product.image;
  }

  return node;
}
