import type { Importer, ParsedImport } from "./types";
import { parseDelimitedReviewFile, type FieldAliases } from "./delimitedParser.server";

// Stamped.io's own documented CSV import-template spec (stampedsupport.stamped.io, "Managing
// Reviews: Import reviews into Stamped"): product_id, product_handle, productUrl,
// productImageUrl, photoFilenames, videoFilenames, productTitle, rating, title, author, email,
// body, created_at, published, reply, replied_at, publishedReply, tags, recommended, votes_up,
// votes_down, location, featured. Stamped's own "Export" feature (Reviews > filter > download)
// doesn't publish its raw export column names separately from this template, so — same caveat
// as loox.server.ts — this is built against Stamped's documented spec, with generous fallback
// aliases layered on to absorb real-vs-documented header drift, not verified against a live
// export file.
//
// Unlike Judge.me/Loox, Stamped's schema DOES include a real productTitle column, so a Stamped
// import can fall back to exact/fuzzy title matching (productMatcher.server.ts) even when
// product_id/product_handle are both missing from a given row. It also has an explicit "title"
// column, unlike Judge.me/Loox — Stamped reviews are more likely to arrive with real titles.
const FIELD_ALIASES: FieldAliases = {
  product: ["producttitle", "product_title", "product", "product_name"],
  productId: ["product_id", "productid"],
  variantId: ["variant_id", "variantid"],
  productHandle: ["product_handle", "handle"],
  productUrl: ["producturl", "product_url", "url"],
  productSlug: ["product_slug"],
  sku: ["sku"],
  rating: ["rating", "score"],
  title: ["title", "headline"],
  content: ["body", "review", "content", "review_body"],
  reviewerName: ["author", "reviewer_name", "reviewer", "name"],
  reviewerEmail: ["email", "reviewer_email"],
  reviewerLocation: ["location", "reviewer_location"],
  verifiedPurchase: ["verified_purchase", "verified", "verified_buyer"],
  createdAt: ["created_at", "date", "review_date"],
  // Stamped's own column is a plain TRUE/FALSE boolean, not a moderation-state word like
  // Judge.me's `curated` — parseBoolean/parseAutoApprove in reviewImportExport.server.ts
  // already treat "true"/"yes"/"1"/"y" (case-insensitively) as auto-approve and anything else
  // as held-for-moderation, so this passes straight through with no translation needed.
  status: ["published", "status", "approved"],
  externalId: ["review_id", "id"],
  reply: ["reply"],
  repliedAt: ["replied_at", "reply_date"],
};

// "product" isn't required — Stamped rows can identify their product via product_id/
// product_handle/productTitle, and productMatcher.server.ts already tries all three in
// priority order. Requiring any single one here would reject valid rows that use a different
// identifier than whichever one this list picked.
const REQUIRED_FIELDS: Array<keyof FieldAliases> = ["rating", "content"];

export function createStampedImporter(): Importer {
  return {
    name: "Stamped.io",
    source: "stamped",
    parse(fileContent: string): ParsedImport {
      return parseDelimitedReviewFile(fileContent, FIELD_ALIASES, REQUIRED_FIELDS);
    },
  };
}
