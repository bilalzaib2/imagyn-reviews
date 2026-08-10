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

// Richer than ImportRowIssue — the "Missing Products" report needs to show a merchant exactly
// what was in the row (not just a pre-formatted sentence), so they can fix the source data or
// decide it's a genuinely unmatchable row (e.g. a store-level review with no product at all).
export interface MissingProductIssue {
  row: number;
  productId: string | null;
  productHandle: string | null;
  productUrl: string | null;
  productTitle: string | null;
  reason: string;
}

export interface ImportResult {
  totalRows: number;
  // Rows that became (or, in a dry run, would become) a Review record — published immediately
  // or held for moderation. A single bad row never aborts the batch; every other row is still
  // attempted (see importReviews).
  imported: number;
  heldForModeration: number;
  duplicates: number;
  // Genuinely distinct from `errors`: the row was well-formed, but no product in this store
  // matched any of the identifiers productMatcher.server.ts tried, in priority order.
  missingProducts: MissingProductIssue[];
  // Recoverable, non-blocking signals worth a merchant's attention — currently just "this row
  // only matched by fuzzy title similarity, double-check it landed on the right product."
  warnings: ImportRowIssue[];
  // Hard validation failures — bad rating, empty content — the row was skipped outright.
  errors: ImportRowIssue[];
  // True when no Review rows were actually written — see importReviews's dryRun parameter.
  dryRun: boolean;
  // Derived, top-level counts mirroring the arrays above — computed once here so callers (the
  // route, this file's own report) don't each re-derive the same arithmetic from the arrays.
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  invalidRows: number;
  // What importing this exact file for real would create (or did create, outside a dry run) —
  // matched, valid, non-duplicate rows. Identical to `imported` today; kept as its own named
  // field because "expected imported count" is what a dry-run report is actually for.
  expectedImportedCount: number;
  // Which tier of productMatcher.server.ts's priority chain resolved each matched row —
  // covers every row that matched (imported, held for moderation, duplicate, or invalid all
  // require a successful match first; only missingProducts rows have no tier). Lets a
  // merchant (or this file's own dry-run report) see e.g. "5,800 by product ID, 12 by handle,
  // 3 by fuzzy title" rather than just a pass/fail count.
  matchTierCounts: Record<ProductMatchTier, number>;
}

function emptyMatchTierCounts(): Record<ProductMatchTier, number> {
  return {
    shopify_product_id: 0,
    variant_id: 0,
    handle: 0,
    url: 0,
    slug: 0,
    sku: 0,
    exact_title: 0,
    normalized_title: 0,
    fuzzy: 0,
  };
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

function parseDate(raw: string): Date | undefined {
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

// Stable-ID-based dedup when the source provides one (Judge.me's metaobject_handle), falling
// back to the same content-based check used when it doesn't. ID-based matching is strictly
// more reliable: a review whose title/body was edited between two exports would slip past a
// content-only check, but never past its own stable ID.
async function isDuplicate(
  storeId: string,
  productId: string,
  reviewerName: string,
  content: string,
  externalId: string | undefined,
): Promise<boolean> {
  if (externalId) {
    const existingById = await prisma.review.findFirst({
      where: { storeId, externalId, deletedAt: null },
      select: { id: true },
    });
    if (existingById) return true;
  }

  const existingByContent = await prisma.review.findFirst({
    where: { storeId, productId, reviewerName, content, deletedAt: null },
    select: { id: true },
  });

  return Boolean(existingByContent);
}

function buildMissingProductIssue(row: ParsedReviewRow): MissingProductIssue {
  const attempted: string[] = [];
  if (row.productId) attempted.push(`Shopify product ID "${row.productId}"`);
  if (row.variantId) attempted.push(`variant ID "${row.variantId}"`);
  if (row.productHandle) attempted.push(`handle "${row.productHandle}"`);
  if (row.productUrl) attempted.push(`URL "${row.productUrl}"`);
  if (row.productSlug) attempted.push(`slug "${row.productSlug}"`);
  if (row.sku) attempted.push(`SKU "${row.sku}"`);
  if (row.product) attempted.push(`title "${row.product}"`);

  const reason =
    attempted.length === 0
      ? "The row had no product identifier at all (likely a store-level review, not tied to any product) — Imagyn Reviews requires every review to be linked to a product."
      : `Tried ${attempted.join(", ")} — none matched a product in your synced catalog. Sync your product catalog (Products → Sync) and re-import.`;

  return {
    row: row.row,
    productId: row.productId || null,
    productHandle: row.productHandle || null,
    productUrl: row.productUrl || null,
    productTitle: row.product || null,
    reason,
  };
}

type RowOutcome =
  | { kind: "imported"; tier: ProductMatchTier | null }
  | { kind: "pending"; tier: ProductMatchTier | null }
  | { kind: "duplicate"; tier: ProductMatchTier | null }
  | { kind: "missing_product" }
  | { kind: "error"; reason: string; tier: ProductMatchTier | null };

async function importRow(
  storeId: string,
  row: ParsedReviewRow,
  matcher: ProductMatcher,
  admin: AdminApiContext | null,
  dryRun: boolean,
): Promise<RowOutcome> {
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
    return {
      kind: "error",
      reason: `Rating must be a whole number between ${RATING_MIN} and ${RATING_MAX} (got "${row.rating}").`,
      tier: match.tier,
    };
  }

  if (!row.content) {
    return { kind: "error", reason: "Review content is required.", tier: match.tier };
  }

  const reviewerName = row.reviewerName || "Anonymous";

  if (await isDuplicate(storeId, match.productId, reviewerName, row.content, row.externalId)) {
    return { kind: "duplicate", tier: match.tier };
  }

  // A dry run must never write anything — every check above (matching, validation, duplicate
  // detection) already ran for real against the live database, so the reported outcome is
  // exactly what a real import would do; only the actual Review row is skipped.
  if (dryRun) {
    const willAutoApprove = parseAutoApprove(row.status);
    return willAutoApprove ? { kind: "imported", tier: match.tier } : { kind: "pending", tier: match.tier };
  }

  const review = await createReview(storeId, {
    productId: match.productId,
    rating,
    title: row.title || null,
    content: row.content,
    reviewerName,
    reviewerEmail: row.reviewerEmail || null,
    reviewerLocation: row.reviewerLocation || null,
    verifiedPurchase: parseBoolean(row.verifiedPurchase),
    createdAt: parseDate(row.createdAt),
    autoApprove: parseAutoApprove(row.status),
    externalId: row.externalId || null,
    reply: row.reply || null,
    repliedAt: parseDate(row.repliedAt ?? "") ?? null,
  });

  return review.isPublished ? { kind: "imported", tier: match.tier } : { kind: "pending", tier: match.tier };
}

function emptyResult(totalRows: number, dryRun: boolean): ImportResult {
  return {
    totalRows,
    imported: 0,
    heldForModeration: 0,
    duplicates: 0,
    missingProducts: [],
    warnings: [],
    errors: [],
    dryRun,
    matchedRows: 0,
    unmatchedRows: 0,
    duplicateRows: 0,
    invalidRows: 0,
    expectedImportedCount: 0,
    matchTierCounts: emptyMatchTierCounts(),
  };
}

// The only DB-aware entry point for imports — parses via whichever Importer the source maps to
// (see importers/provider.server.ts), then matches, validates, dedupes, and creates one row at
// a time so a single bad row never aborts the batch. `admin` is optional: when present, the
// product matcher can fall back to live Shopify lookups for variant-ID/SKU rows that don't
// resolve against the locally synced product catalog (see productMatcher.server.ts); without
// it, those two tiers are simply skipped. `dryRun`: when true, every read (product matching,
// duplicate detection) runs for real against the live database, but no Review row is ever
// created — see importRow's dryRun branch. Used to produce an accurate "what would happen"
// report before committing to a real import.
export async function importReviews(
  storeId: string,
  source: ImportSource,
  fileContent: string,
  admin: AdminApiContext | null = null,
  dryRun: boolean = false,
): Promise<ImportResult> {
  const logPrefix = `[import:${source}]${dryRun ? "[dry-run]" : ""} store=${storeId}`;
  const importer = getImporter(source);
  const { rows, fileErrors } = importer.parse(fileContent);

  if (fileErrors.length > 0) {
    // File-level rejection (e.g. a required column genuinely missing) — logged distinctly from
    // per-row rejections below, since this means zero rows were even attempted, not that some
    // rows individually failed.
    console.error(`${logPrefix} file rejected before any row was processed:`, fileErrors);
    const result = emptyResult(0, dryRun);
    result.errors = fileErrors.map((reason) => ({ row: 0, reason }));
    result.invalidRows = result.errors.length;
    return result;
  }

  console.log(`${logPrefix} starting — ${rows.length} row(s) parsed`);

  const matcher = await ProductMatcher.forStore(storeId);
  const result = emptyResult(rows.length, dryRun);

  for (const row of rows) {
    const outcome = await importRow(storeId, row, matcher, admin, dryRun);

    if (outcome.kind !== "missing_product" && outcome.tier) {
      result.matchTierCounts[outcome.tier] += 1;
    }

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
      case "missing_product": {
        const issue = buildMissingProductIssue(row);
        result.missingProducts.push(issue);
        // Individually logged, not just aggregated in the returned report — so "why was row
        // 502 rejected" is answerable from Railway logs alone, without needing the merchant to
        // still have the import modal open or to re-run the import to see it again.
        console.warn(`${logPrefix} row ${issue.row} unmatched: ${issue.reason}`);
        break;
      }
      case "error":
        result.errors.push({ row: row.row, reason: outcome.reason });
        console.warn(`${logPrefix} row ${row.row} invalid: ${outcome.reason}`);
        break;
    }
  }

  result.unmatchedRows = result.missingProducts.length;
  result.invalidRows = result.errors.length;
  result.duplicateRows = result.duplicates;
  result.matchedRows = result.imported + result.duplicates + result.errors.length;
  result.expectedImportedCount = result.imported;

  console.log(
    `${logPrefix} complete — total=${result.totalRows} matched=${result.matchedRows} ` +
      `unmatched=${result.unmatchedRows} duplicates=${result.duplicateRows} invalid=${result.invalidRows} ` +
      `imported=${result.imported} heldForModeration=${result.heldForModeration} ` +
      `tiers=${JSON.stringify(result.matchTierCounts)}`,
  );

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
  "external_id",
  "reply",
  "reply_date",
] as const;

// Uses the same column names importReviews accepts, so an exported file can be re-imported
// (into this store or another) without edits. Includes product_id/product_handle alongside the
// display-only product title, so a re-import always resolves at tier 1 or tier 3 of the
// matcher instead of falling back to title matching, and external_id so a re-import of an
// exported file is itself idempotent.
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
    external_id: review.externalId ?? "",
    reply: review.reply ?? "",
    reply_date: review.repliedAt?.toISOString() ?? "",
  }));

  return Papa.unparse({ fields: [...EXPORT_COLUMNS], data });
}
