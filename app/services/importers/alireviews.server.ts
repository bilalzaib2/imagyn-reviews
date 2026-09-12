import type { Importer, ParsedImport } from "./types";
import { parseDelimitedReviewFile, type FieldAliases } from "./delimitedParser.server";

// Ali Reviews' own documented CSV import template (help.alireviews.io, "Importing reviews from
// a CSV file"): Product handle, Customer country code (Alpha-2), Customer name, Star rating,
// Text reviews, Published date, Image link (max 5 images, .jpg/.jpeg/.png/.avif/.gif). That
// article explicitly warns "Do not change column names or labels," confirming these are real,
// current header names — not a guess. Ali Reviews' own "Export" feature (if one exists) doesn't
// publish its raw output column names separately from this import template, so — same caveat as
// loox.server.ts/stamped.server.ts — this is built against the documented template, with the
// same generous fallback aliases layered on, NOT verified against a live export file.
//
// This schema is thinner than every other source here: no product title/name column (handle
// only), no reviewer email, no verified-purchase column, no title column, no external/review ID,
// no reply column. None of that data can be imported for Ali Reviews because the platform's own
// documented format simply doesn't carry it — not an oversight in this adapter.
const FIELD_ALIASES: FieldAliases = {
  product: ["product", "product_title", "product_name"],
  productId: ["product_id", "productid"],
  variantId: ["variant_id", "variantid"],
  productHandle: ["product_handle", "handle"],
  productUrl: ["product_url", "url"],
  productSlug: ["product_slug"],
  sku: ["sku"],
  rating: ["star_rating", "rating", "score"],
  title: ["title", "headline"],
  content: ["text_reviews", "review", "content", "body", "review_text"],
  reviewerName: ["customer_name", "reviewer_name", "author", "name"],
  reviewerEmail: ["email", "reviewer_email"],
  // Ali Reviews' own column is a 2-letter country code, not a free-text location — kept in the
  // same field for now (no separate country column in the shared ParsedReviewRow shape) rather
  // than inventing a new one for a single source's narrower data.
  reviewerLocation: ["customer_country_code", "location", "reviewer_location"],
  // No verified-purchase concept anywhere in Ali Reviews' documented template.
  verifiedPurchase: ["verified_purchase", "verified"],
  createdAt: ["published_date", "created_at", "date"],
  // No publish-status column in the documented template — absent entirely means
  // parseAutoApprove sees "" and auto-approves, correct since a CSV a merchant exported from
  // Ali Reviews is, by definition, already live there.
  status: ["status", "published", "approved"],
  externalId: ["review_id", "id"],
  reply: ["reply"],
  repliedAt: ["replied_at", "reply_date"],
  mediaUrls: ["image_link", "image_url", "image_urls", "picture_urls"],
};

// Only rating + content are required, same convention as every other adapter — "product" isn't
// required since Ali Reviews identifies the product by handle, and requiring the handle itself
// would reject any hand-edited row that supplies a different identifier instead.
const REQUIRED_FIELDS: Array<keyof FieldAliases> = ["rating", "content"];

export function createAliReviewsImporter(): Importer {
  return {
    name: "Ali Reviews",
    source: "alireviews",
    parse(fileContent: string): ParsedImport {
      return parseDelimitedReviewFile(fileContent, FIELD_ALIASES, REQUIRED_FIELDS);
    },
  };
}
