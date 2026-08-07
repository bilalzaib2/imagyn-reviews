import Papa from "papaparse";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { createReview } from "./review.server";
import { getImporter } from "./importers/provider.server";
import { ProductMatcher, type ProductMatchTier } from "./importers/productMatcher.server";
import type { ImportSource, ParsedReviewRow } from "./importers/types";

export interface ImportRowIssue {
  row: number;
  reason: string;
}

export interface ImportResult {
  totalRows: number;
  // Rows that became a Review record — published immediately or held for moderation. A single
  // bad row never aborts the batch; every other row is still attempted (see importReviews).
  imported: number;
  heldForModeration: number;
  duplicates: number;
  // Genuinely distinct from `errors`: the row was well-formed, but no product in this store
  // matched any of the identifiers productMatcher.server.ts tried, in priority order.
  missingProducts: ImportRowIssue[];
  // Recoverable, non-blocking signals worth a merchant's attention — currently just "this row
  // only matched by fuzzy title similarity, double-check it landed on the right product."
  warnings: ImportRowIssue[];
  // Hard validation failures — bad rating, empty content — the row was skipped outright.
  errors: ImportRowIssue[];
}

const RATING_MIN = 1;
const RATING_MAX = 5;

function parseRating(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX ? value : null;
}

function parseBoolean(raw: string): boolean {
  return ["true", "yes", "1", "y"].includes(raw.trim().toLowerCase());
}

function parseCreatedAt(raw: string): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseAutoApprove(raw: string): boolean {
  // Reviews arriving via import were already vetted on whatever platform they came from, so
  // the default (no status column, or "approved") is to publish immediately — unlike a
  // customer submission, which always starts PENDING. Only an explicit "pending" / "rejected"
  // value holds a row back for moderation.
  const normalized = raw.trim().toLowerCase();
  return normalized === "" || normalized === "approved" || normalized === "published" || parseBoolean(raw);
}

async function isDuplicate(storeId: string, productId: string, reviewerName: string, content: string) {
  const existing = await prisma.review.findFirst({
    where: { storeId, productId, reviewerName, content, deletedAt: null },
    select: { id: true },
  });

  return Boolean(existing);
}

function describeAttemptedIdentifiers(row: ParsedReviewRow): string {
  const attempted: string[] = [];
  if (row.productId) attempted.push(`Shopify product ID "${row.productId}"`);
  if (row.variantId) attempted.push(`variant ID "${row.variantId}"`);
  if (row.productHandle) attempted.push(`handle "${row.productHandle}"`);
  if (row.productUrl) attempted.push(`URL "${row.productUrl}"`);
  if (row.productSlug) attempted.push(`slug "${row.productSlug}"`);
  if (row.sku) attempted.push(`SKU "${row.sku}"`);
  if (row.product) attempted.push(`title "${row.product}"`);

  if (attempted.length === 0) {
    return "the row had no product identifier at all";
  }
  return `tried ${attempted.join(", ")}`;
}

type RowOutcome =
  | { kind: "imported"; tier: ProductMatchTier | null }
  | { kind: "pending"; tier: ProductMatchTier | null }
  | { kind: "duplicate" }
  | { kind: "missing_product" }
  | { kind: "error"; reason: string };

async function importRow(storeId: string, row: ParsedReviewRow, matcher: ProductMatcher, admin: AdminApiContext | null): Promise<RowOutcome> {
  const match = await matcher.match(
    {
      productId: row.productId,
      variantId: row.variantId,
      handle: row.productHandle,
      url: row.productUrl,
      slug: row.productSlug,
      sku: row.sku,
      title: row.product,
    },
    admin,
  );

  if (!match.productId) {
    return { kind: "missing_product" };
  }

  const rating = parseRating(row.rating);
  if (rating === null) {
    return { kind: "error", reason: `Rating must be a whole number between ${RATING_MIN} and ${RATING_MAX} (got "${row.rating}").` };
  }

  if (!row.content) {
    return { kind: "error", reason: "Review content is required." };
  }

  const reviewerName = row.reviewerName || "Anonymous";

  if (await isDuplicate(storeId, match.productId, reviewerName, row.content)) {
    return { kind: "duplicate" };
  }

  const review = await createReview({
    productId: match.productId,
    rating,
    title: row.title || null,
    content: row.content,
    reviewerName,
    reviewerEmail: row.reviewerEmail || null,
    reviewerLocation: row.reviewerLocation || null,
    verifiedPurchase: parseBoolean(row.verifiedPurchase),
    createdAt: parseCreatedAt(row.createdAt),
    autoApprove: parseAutoApprove(row.status),
  });

  return review.isPublished ? { kind: "imported", tier: match.tier } : { kind: "pending", tier: match.tier };
}

// The only DB-aware entry point for imports — parses via whichever Importer the source maps to
// (see importers/provider.server.ts), then matches, validates, dedupes, and creates one row at
// a time so a single bad row never aborts the batch. `admin` is optional: when present, the
// product matcher can fall back to live Shopify lookups for variant-ID/SKU rows that don't
// resolve against the locally synced product catalog (see productMatcher.server.ts); without
// it, those two tiers are simply skipped, same as before this existed.
export async function importReviews(
  storeId: string,
  source: ImportSource,
  fileContent: string,
  admin: AdminApiContext | null = null,
): Promise<ImportResult> {
  const importer = getImporter(source);
  const { rows, fileErrors } = importer.parse(fileContent);

  if (fileErrors.length > 0) {
    return {
      totalRows: 0,
      imported: 0,
      heldForModeration: 0,
      duplicates: 0,
      missingProducts: [],
      warnings: [],
      errors: fileErrors.map((reason) => ({ row: 0, reason })),
    };
  }

  const matcher = await ProductMatcher.forStore(storeId);
  const result: ImportResult = {
    totalRows: rows.length,
    imported: 0,
    heldForModeration: 0,
    duplicates: 0,
    missingProducts: [],
    warnings: [],
    errors: [],
  };

  for (const row of rows) {
    const outcome = await importRow(storeId, row, matcher, admin);

    switch (outcome.kind) {
      case "imported":
        result.imported += 1;
        if (outcome.tier === "fuzzy") {
          result.warnings.push({ row: row.row, reason: `Matched "${row.product}" by approximate title similarity — verify this landed on the right product.` });
        }
        break;
      case "pending":
        result.imported += 1;
        result.heldForModeration += 1;
        if (outcome.tier === "fuzzy") {
          result.warnings.push({ row: row.row, reason: `Matched "${row.product}" by approximate title similarity — verify this landed on the right product.` });
        }
        break;
      case "duplicate":
        result.duplicates += 1;
        break;
      case "missing_product":
        result.missingProducts.push({
          row: row.row,
          reason: `Product not found — ${describeAttemptedIdentifiers(row)}. Sync your product catalog (Products → Sync) and re-import.`,
        });
        break;
      case "error":
        result.errors.push({ row: row.row, reason: outcome.reason });
        break;
    }
  }

  return result;
}

const EXPORT_COLUMNS = [
  "product",
  "product_id",
  "product_handle",
  "rating",
  "title",
  "content",
  "reviewer_name",
  "reviewer_email",
  "reviewer_location",
  "verified_purchase",
  "created_at",
  "status",
] as const;

// Uses the same column names importReviews accepts, so an exported file can be re-imported
// (into this store or another) without edits. Now includes product_id/product_handle
// alongside the display-only product title, so a re-import always resolves at tier 1 or tier
// 3 of the matcher instead of falling back to title matching.
export async function exportReviewsToCsv(storeId: string): Promise<string> {
  const reviews = await prisma.review.findMany({
    where: { storeId, deletedAt: null },
    include: { product: { select: { name: true, shopifyProductId: true, handle: true } } },
    orderBy: { createdAt: "asc" },
  });

  const data = reviews.map((review) => ({
    product: review.product?.name ?? review.productTitle ?? "",
    product_id: review.product?.shopifyProductId ?? "",
    product_handle: review.product?.handle ?? "",
    rating: review.rating,
    title: review.title ?? "",
    content: review.content,
    reviewer_name: review.reviewerName,
    reviewer_email: review.reviewerEmail ?? "",
    reviewer_location: review.reviewerLocation ?? "",
    verified_purchase: review.verifiedPurchase ? "true" : "false",
    created_at: review.createdAt.toISOString(),
    status: review.status,
  }));

  return Papa.unparse({ fields: [...EXPORT_COLUMNS], data });
}
