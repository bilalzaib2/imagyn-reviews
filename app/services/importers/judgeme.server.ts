import type { Importer, ParsedImport, ParsedReviewRow } from "./types";
import { parseDelimitedReviewFile, type FieldAliases } from "./delimitedParser.server";

// Judge.me's own CSV export column names, layered on top of the generic aliases (a Judge.me
// export is still just a CSV — buildHeaderMap in delimitedParser.server.ts matches whichever
// alias is present, so this list is additive, not a replacement). `product_id` and
// `product_handle` are the two columns that matter most: Judge.me exports Shopify's own bare
// numeric product id and handle, which is what makes tier-1/tier-3 matching in
// productMatcher.server.ts resolve almost every row without ever falling back to title
// matching.
//
// Verified directly against a real "all published reviews" export from a production store
// (2,540 rows) — Judge.me's actual columns are: title, body, rating, review_date, source,
// curated, reviewer_name, reviewer_email, product_id, product_handle, reply, reply_date,
// picture_urls, ip_address, location, metaobject_handle. Notably: there is NO product title/
// name column at all (only id + handle identify the product — see below on REQUIRED_FIELDS),
// and NO explicit verified-purchase column (see applyJudgemeConventions's inference from
// `source`).
const FIELD_ALIASES: FieldAliases = {
  // No real Judge.me export has ever been seen to include a product title/name column — id +
  // handle are the only product identifiers it exports. These aliases exist only in case a
  // merchant hand-edits a re-exported file to add one; they're never relied on for a genuine
  // Judge.me export, and REQUIRED_FIELDS below deliberately does not demand this field.
  product: ["product", "product_title", "product_name"],
  productId: ["product_id", "productid"],
  variantId: ["variant_id", "variantid"],
  productHandle: ["product_handle", "handle"],
  productUrl: ["product_url", "url"],
  productSlug: ["product_slug"],
  sku: ["sku"],
  rating: ["rating", "score"],
  title: ["title"],
  content: ["body", "review", "content", "review_body"],
  reviewerName: ["reviewer_name", "reviewer", "author", "name"],
  reviewerEmail: ["reviewer_email", "email"],
  reviewerLocation: ["reviewer_location", "location"],
  // No real Judge.me export column maps here directly — "verified"/"verified_buyer" are
  // speculative aliases for a hand-edited re-export. The real signal (source === "email") is
  // read straight from the raw CSV record in applyJudgemeConventions below, since "source"
  // isn't part of the shared ParsedReviewRow shape.
  verifiedPurchase: ["verified", "verified_buyer", "verified_purchase"],
  createdAt: ["review_date", "date", "created_at"],
  // Judge.me's moderation state — see mapCuratedToStatus below for the actual translation.
  // "status"/"approved" stay as fallback aliases in case a merchant re-exports through a
  // spreadsheet tool that renamed the column.
  status: ["curated", "status", "approved"],
  // Judge.me's own stable per-review identifier — despite the name, this is what makes
  // duplicate detection reliable across re-imports of the same export (see
  // reviewImportExport.server.ts's isDuplicate). Format observed: "review-<uuid>".
  externalId: ["metaobject_handle", "review_id", "id"],
  reply: ["reply"],
  repliedAt: ["reply_date"],
};

// Deliberately excludes "product" — a genuine Judge.me export has no product title/name
// column at all (confirmed against a real 2,540-row export), only product_id/product_handle.
// Requiring "product" here would reject every real Judge.me file outright at the file-validation
// stage, before a single row was even attempted — which is exactly what happened before this
// was caught. Product identity for Judge.me rows is established by productId/productHandle,
// handled entirely by productMatcher.server.ts, not by this required-columns check.
const REQUIRED_FIELDS: Array<keyof FieldAliases> = ["rating", "content"];

// Judge.me's `curated` values, per Judge.me's own documented review states: "ok" (approved/
// published — confirmed as the value used across an entire real "all published reviews"
// export), "hidden" and "spam" (rejected), "not_reviewed"/"pending" (awaiting moderation).
// Matched by substring, defensively, rather than exact string, so a casing or wording variant
// doesn't silently stop mapping correctly — but "ok" is matched as an exact value (not a
// substring of something else) since it's short enough that substring-matching it against
// other words would risk false positives.
function mapCuratedToStatus(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "") return "";
  if (value === "ok") return "approved";

  if (value.includes("unpublish") || value.includes("spam") || value.includes("reject") || value.includes("hidden")) {
    return "rejected";
  }
  if (value.includes("publish") || value.includes("approved")) {
    return "approved";
  }
  if (value.includes("pending") || value.includes("not_review") || value.includes("not reviewed")) {
    return "pending";
  }

  // Unrecognized value — hold for moderation rather than guessing either way.
  return "pending";
}

// Judge.me's export has no explicit verified-purchase column. `source` is the closest real
// signal: "email" means Judge.me sent this merchant's own post-purchase review-request email,
// which only ever goes to a customer who actually bought the product — a legitimate proxy for
// verified purchase. Every other observed source value ("web", "new-rre-flow", "reviews-tab",
// "user-profile", "shopify", "shopify-customer-account") means the review was submitted
// through a form/widget with no purchase check behind it, so those are left unverified rather
// than assumed. This is a best-effort inference, not a certainty — documented here so it's
// never mistaken for a real Judge.me "verified" field.
function inferVerifiedFromSource(source: string): string {
  return source.trim().toLowerCase() === "email" ? "true" : "";
}

function applyJudgemeConventions(row: ParsedReviewRow, record: Record<string, string>): ParsedReviewRow {
  return {
    ...row,
    status: mapCuratedToStatus(row.status),
    verifiedPurchase: row.verifiedPurchase || inferVerifiedFromSource(record.source ?? ""),
  };
}

export function createJudgemeImporter(): Importer {
  return {
    name: "Judge.me",
    source: "judgeme",
    parse(fileContent: string): ParsedImport {
      return parseDelimitedReviewFile(fileContent, FIELD_ALIASES, REQUIRED_FIELDS, applyJudgemeConventions);
    },
  };
}
