import type { Importer, ParsedImport } from "./types";
import { parseDelimitedReviewFile, type FieldAliases } from "./delimitedParser.server";

// Loox's own documented CSV column spec (help.loox.io, "Import Reviews to Loox Using a Custom
// CSV File"): product_handle, product_Id, rating, author, email, body, created_at, photo_url,
// reply, replied_at, verified_purchase, incentivized. Loox's native "Export to .csv" button
// (Manage Reviews > Product/Store reviews > Export) also produces a plain CSV — confirmed via
// Loox's own help docs — but its exact raw column names haven't been verified against a real
// export file (Loox doesn't publish that separately from the import-template spec above). The
// generous aliases below are the same defensive layering csv.server.ts/judgeme.server.ts use
// specifically to absorb exactly that kind of real-vs-documented header drift.
//
// No title column exists in Loox's documented schema at all (mirrors Judge.me) — title stays
// genuinely optional, never backfilled with a placeholder (see reviewImportExport.server.ts).
const FIELD_ALIASES: FieldAliases = {
  product: ["product", "product_title", "product_name"],
  productId: ["product_id", "productid"],
  variantId: ["variant_id", "variantid"],
  productHandle: ["product_handle", "handle"],
  productUrl: ["product_url", "url"],
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
  // No publish-status column in Loox's documented schema — absent entirely means
  // parseAutoApprove(row.status) sees "" and auto-approves, which is correct: everything a
  // merchant exports from Loox is, by definition, already live there.
  status: ["status", "published", "approved"],
  externalId: ["review_id", "id"],
  reply: ["reply"],
  repliedAt: ["replied_at", "reply_date"],
};

// Deliberately excludes "product" — like Judge.me, Loox's schema identifies the product by
// handle/id, never by a name/title column, so requiring one would reject every real file
// outright at the file-validation stage before a single row was attempted.
const REQUIRED_FIELDS: Array<keyof FieldAliases> = ["rating", "content"];

export function createLooxImporter(): Importer {
  return {
    name: "Loox",
    source: "loox",
    parse(fileContent: string): ParsedImport {
      return parseDelimitedReviewFile(fileContent, FIELD_ALIASES, REQUIRED_FIELDS);
    },
  };
}
