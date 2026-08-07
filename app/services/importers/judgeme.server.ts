import type { Importer, ParsedImport, ParsedReviewRow } from "./types";
import { parseDelimitedReviewFile, type FieldAliases } from "./delimitedParser.server";

// Judge.me's own CSV export column names, layered on top of the generic aliases (a Judge.me
// export is still just a CSV — buildHeaderMap in delimitedParser.server.ts matches whichever
// alias is present, so this list is additive, not a replacement). `product_id` and
// `product_handle` are the two columns that matter most: Judge.me exports Shopify's own bare
// numeric product id and handle, which is what makes tier-1/tier-3 matching in
// productMatcher.server.ts resolve almost every row without ever falling back to title
// matching.
const FIELD_ALIASES: FieldAliases = {
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
  // Judge.me's own column is usually just "verified" — "verified_buyer" covers an export
  // variant seen in some Judge.me plans/versions.
  verifiedPurchase: ["verified", "verified_buyer", "verified_purchase"],
  createdAt: ["review_date", "date", "created_at"],
  // Judge.me's moderation state — see mapCuratedToStatus below for the actual translation.
  // "status"/"approved" stay as fallback aliases in case a merchant re-exports through a
  // spreadsheet tool that renamed the column.
  status: ["curated", "status", "approved"],
};

const REQUIRED_FIELDS: Array<keyof FieldAliases> = ["product", "rating", "content"];

// Judge.me's `curated` values (not_reviewed / pending / published / unpublished / spam,
// spelling varies slightly by export version) don't match the "approved"/"pending"/"rejected"
// vocabulary reviewImportExport.server.ts's parseAutoApprove expects — translated here,
// defensively by substring rather than exact string, so a casing or wording variant Judge.me
// ships later doesn't silently stop mapping correctly.
function mapCuratedToStatus(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === "") return "";

  if (value.includes("unpublish") || value.includes("spam") || value.includes("reject") || value.includes("hidden")) {
    return "rejected";
  }
  if (value.includes("publish")) {
    return "approved";
  }
  if (value.includes("pending") || value.includes("not_review") || value.includes("not reviewed")) {
    return "pending";
  }

  // Unrecognized value — hold for moderation rather than guessing either way.
  return "pending";
}

function applyJudgemeConventions(row: ParsedReviewRow): ParsedReviewRow {
  return {
    ...row,
    status: mapCuratedToStatus(row.status),
  };
}

export function createJudgemeImporter(): Importer {
  return {
    name: "Judge.me",
    source: "judgeme",
    parse(fileContent: string): ParsedImport {
      const parsed = parseDelimitedReviewFile(fileContent, FIELD_ALIASES, REQUIRED_FIELDS);
      return { ...parsed, rows: parsed.rows.map(applyJudgemeConventions) };
    },
  };
}
