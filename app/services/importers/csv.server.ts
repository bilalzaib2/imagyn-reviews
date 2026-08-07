import type { Importer, ParsedImport } from "./types";
import { parseDelimitedReviewFile, type FieldAliases } from "./delimitedParser.server";

// Accepted header spellings per field — lets CSVs exported from a spreadsheet or another
// review tool work without forcing merchants onto one exact header set, while staying a plain
// lookup table rather than a fuzzy-matching engine. The structured identifier fields
// (productId/variantId/productHandle/productUrl/productSlug/sku) are optional — a generic CSV
// without them just falls back further down productMatcher.server.ts's priority chain.
const FIELD_ALIASES: FieldAliases = {
  product: ["product", "product_name", "product_title"],
  productId: ["product_id", "shopify_product_id", "productid"],
  variantId: ["variant_id", "shopify_variant_id", "variantid"],
  productHandle: ["product_handle", "handle"],
  productUrl: ["product_url", "url", "link", "product_link"],
  productSlug: ["product_slug", "slug"],
  sku: ["sku", "variant_sku"],
  rating: ["rating", "stars", "score"],
  title: ["title", "headline", "summary"],
  content: ["content", "review", "body", "text", "review_text", "review_content"],
  reviewerName: ["reviewer_name", "customer_name", "name", "author"],
  reviewerEmail: ["reviewer_email", "customer_email", "email"],
  reviewerLocation: ["reviewer_location", "location"],
  verifiedPurchase: ["verified_purchase", "verified"],
  createdAt: ["created_at", "date", "review_date"],
  status: ["status", "approved"],
};

const REQUIRED_FIELDS: Array<keyof FieldAliases> = ["product", "rating", "content"];

export function createCsvImporter(): Importer {
  return {
    name: "Generic CSV",
    source: "csv",
    parse(fileContent: string): ParsedImport {
      return parseDelimitedReviewFile(fileContent, FIELD_ALIASES, REQUIRED_FIELDS);
    },
  };
}
