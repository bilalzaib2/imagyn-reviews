import Papa from "papaparse";
import { Prisma } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { createReview, updateReview } from "./review.server";
import { getImporter } from "./importers/provider.server";
import { ProductMatcher, type ProductMatchTier } from "./importers/productMatcher.server";
import type { ImportSource, ParsedReviewRow, HeaderOverrides, ColumnDetectionResult } from "./importers/types";
import { recordDataAccess } from "./auditLog.server";
import { parseImportedMediaUrls, validateImportedMediaUrl, MAX_IMPORTED_MEDIA_PER_REVIEW } from "./reviewMedia.server";

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

// Genuinely distinct from MissingProductIssue: the row DID find plausible product matches, but
// more than one, with no reliable way to pick between them (see productMatcher.server.ts's
// ambiguous detection). Never auto-attached to either candidate — a merchant must resolve
// these manually (e.g. by adding a product_id/handle column, or editing the review after a
// deliberate choice), the same "leave it and ask, never guess" contract missingProducts uses.
export interface AmbiguousProductIssue {
  row: number;
  productTitle: string | null;
  candidateProductIds: string[];
  reason: string;
}

export interface SkippedMediaIssue {
  row: number;
  url: string;
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
  // A duplicate row (matched by externalId or by product+reviewer+content) whose *existing*
  // review has no title, where this row's own title is non-empty — the file's title is
  // backfilled onto that existing row instead of being silently discarded as "just a
  // duplicate." Never overwrites a title that's already set; see importRow's own comment for
  // why this is safe to do unconditionally rather than requiring a merchant's confirmation
  // per row. Counted separately from `duplicates` (a repaired row is not double-counted there).
  titlesRepaired: number;
  // Genuinely distinct from `errors`: the row was well-formed, but no product in this store
  // matched any of the identifiers productMatcher.server.ts tried, in priority order.
  missingProducts: MissingProductIssue[];
  // Genuinely distinct from missingProducts: the row matched MORE than one plausible product
  // with no reliable way to choose — never auto-attached to either. See
  // productMatcher.server.ts's ambiguous detection and AmbiguousProductIssue's own comment.
  ambiguousProducts: AmbiguousProductIssue[];
  // Real ReviewMedia rows created (or, in a dry run, that would be created) referencing a
  // validated external URL — see reviewMedia.server.ts's validateImportedMediaUrl. Never a
  // server-side download; the URL is stored as-is.
  importedMedia: number;
  skippedMedia: SkippedMediaIssue[];
  // Recoverable, non-blocking signals worth a merchant's attention — currently just "this row
  // only matched by fuzzy title similarity, double-check it landed on the right product."
  warnings: ImportRowIssue[];
  // Hard validation failures — bad rating, empty content — the row was skipped outright.
  errors: ImportRowIssue[];
  // True when no Review rows were actually written — see importReviews's dryRun parameter.
  dryRun: boolean;
  // The real ImportBatch row this import created — undefined for a dry run (no batch is ever
  // created for a preview) or for a file-level rejection. Lets the caller link straight to
  // Import History / offer Undo without a second lookup.
  importBatchId?: string;
  // Derived, top-level counts mirroring the arrays above — computed once here so callers (the
  // route, this file's own report) don't each re-derive the same arithmetic from the arrays.
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
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

interface ExistingReviewMatch {
  id: string;
  title: string | null;
}

// Stable-ID-based dedup when the source provides one (Judge.me's metaobject_handle), falling
// back to the same content-based check used when it doesn't. ID-based matching is strictly
// more reliable: a review whose title/body was edited between two exports would slip past a
// content-only check, but never past its own stable ID. Scoped by importSource in addition to
// externalId — an id string is only guaranteed unique within its own source platform's id
// space, so two different platforms could coincidentally export the same externalId for two
// genuinely different reviews. Returns the existing row's own title (not just whether a match
// exists) so importRow can decide whether a safe title-backfill applies — see its own comment
// for that logic.
async function findExistingReview(
  storeId: string,
  productId: string,
  reviewerName: string,
  content: string,
  externalId: string | undefined,
  importSource: string,
): Promise<ExistingReviewMatch | null> {
  if (externalId) {
    const existingById = await prisma.review.findFirst({
      where: { storeId, externalId, importSource, deletedAt: null },
      select: { id: true, title: true },
    });
    if (existingById) return existingById;
  }

  const existingByContent = await prisma.review.findFirst({
    where: { storeId, productId, reviewerName, content, deletedAt: null },
    select: { id: true, title: true },
  });

  return existingByContent ?? null;
}

// The source platform's own verified-purchase claim/inference (see e.g. judgeme.server.ts's
// inferVerifiedFromSource) is a real, useful signal worth preserving for transparency — but it
// is NEVER reliable enough to become IMAGYN's own verifiedPurchase flag, which Trust
// Certification and the storefront "Verified Buyer" badge both read as real, IMAGYN-checked
// evidence. See docs/IMPORT_VERIFICATION_POLICY.md. An empty string means the source made no
// claim at all (most platforms' documented schemas have no verified column) — kept as `null`,
// not coerced to `false`, so "unknown" is never displayed as an explicit "not verified" claim.
function parseSourceVerified(raw: string): boolean | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return parseBoolean(trimmed);
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

function buildAmbiguousProductIssue(row: ParsedReviewRow, candidateProductIds: string[]): AmbiguousProductIssue {
  return {
    row: row.row,
    productTitle: row.product || null,
    candidateProductIds,
    reason: `"${row.product || "This row"}" matches ${candidateProductIds.length} products in your catalog with no reliable way to tell which one — add a product_id, handle, or SKU column to this row, or edit the review after import.`,
  };
}

type RowOutcome =
  | { kind: "imported"; tier: ProductMatchTier | null; mediaImported: number; mediaSkipped: SkippedMediaIssue[] }
  | { kind: "pending"; tier: ProductMatchTier | null; mediaImported: number; mediaSkipped: SkippedMediaIssue[] }
  | { kind: "duplicate"; tier: ProductMatchTier | null }
  | { kind: "repaired"; tier: ProductMatchTier | null }
  | { kind: "missing_product" }
  | { kind: "ambiguous_product"; candidateProductIds: string[] }
  | { kind: "error"; reason: string; tier: ProductMatchTier | null };

// Validates every URL in a row's media column (works identically for a dry run and a real
// import — validation is pure, no writes) and splits them into what's safe to store vs. what
// must be skipped and why. See reviewMedia.server.ts's validateImportedMediaUrl for the actual
// safety rules (https-only, no private/internal hosts, looks like an image).
function validateRowMedia(row: ParsedReviewRow): { valid: string[]; skipped: SkippedMediaIssue[] } {
  if (!row.mediaUrls) return { valid: [], skipped: [] };

  const urls = parseImportedMediaUrls(row.mediaUrls).slice(0, MAX_IMPORTED_MEDIA_PER_REVIEW * 2);
  const valid: string[] = [];
  const skipped: SkippedMediaIssue[] = [];

  for (const url of urls) {
    const reason = validateImportedMediaUrl(url);
    if (reason) {
      skipped.push({ row: row.row, url, reason });
    } else {
      valid.push(url);
    }
  }

  // Cap AFTER validation, not before — a merchant should see every genuinely invalid URL
  // reported, not have some silently disappear into an early slice.
  const overflow = valid.length - MAX_IMPORTED_MEDIA_PER_REVIEW;
  if (overflow > 0) {
    for (const url of valid.splice(MAX_IMPORTED_MEDIA_PER_REVIEW)) {
      skipped.push({ row: row.row, url, reason: `Exceeds the ${MAX_IMPORTED_MEDIA_PER_REVIEW}-image-per-review limit.` });
    }
  }

  return { valid, skipped };
}

async function importRow(
  storeId: string,
  row: ParsedReviewRow,
  matcher: ProductMatcher,
  admin: AdminApiContext | null,
  dryRun: boolean,
  source: ImportSource,
  importBatchId: string | null,
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

  if (match.ambiguous) {
    return { kind: "ambiguous_product", candidateProductIds: match.candidateProductIds ?? [] };
  }

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

  const existing = await findExistingReview(storeId, match.productId, reviewerName, row.content, row.externalId, source);
  if (existing) {
    // A safe, narrow repair: this row is a duplicate of a review already in the database, but
    // that existing row has no title and this file's row does. This is exactly the shape a
    // re-import of an originally-correct Judge.me export produces after an earlier import (via
    // an older, buggy importer version, or a hand-edited file) lost titles the first time —
    // backfilling here means re-running the same import a merchant already has is a real repair
    // path, not just a no-op. Never touches a title that's already set (existing.title is
    // truthy), so a merchant's own manual edit can never be silently overwritten by re-importing
    // an older or different export of the same review.
    if (!existing.title && row.title) {
      if (!dryRun) {
        await updateReview(storeId, existing.id, { title: row.title });
      }
      return { kind: "repaired", tier: match.tier };
    }
    return { kind: "duplicate", tier: match.tier };
  }

  const media = validateRowMedia(row);

  // A dry run must never write anything — every check above (matching, validation, duplicate
  // detection) already ran for real against the live database, so the reported outcome is
  // exactly what a real import would do; only the actual Review/ReviewMedia rows are skipped.
  if (dryRun) {
    const willAutoApprove = parseAutoApprove(row.status);
    return willAutoApprove
      ? { kind: "imported", tier: match.tier, mediaImported: media.valid.length, mediaSkipped: media.skipped }
      : { kind: "pending", tier: match.tier, mediaImported: media.valid.length, mediaSkipped: media.skipped };
  }

  let review;
  try {
    review = await createReview(storeId, {
      productId: match.productId,
      rating,
      title: row.title || null,
      content: row.content,
      reviewerName,
      reviewerEmail: row.reviewerEmail || null,
      reviewerLocation: row.reviewerLocation || null,
      // NEVER set true from imported data — see docs/IMPORT_VERIFICATION_POLICY.md and
      // parseSourceVerified's own comment. A source's claim/inference is preserved separately
      // below as sourceVerified for transparency, never fed into IMAGYN's own verified-purchase
      // flag, which Trust Certification and the storefront badge read as real, checked evidence.
      verifiedPurchase: false,
      sourceVerified: parseSourceVerified(row.verifiedPurchase),
      createdAt: parseDate(row.createdAt),
      autoApprove: parseAutoApprove(row.status),
      externalId: row.externalId || null,
      reply: row.reply || null,
      repliedAt: parseDate(row.repliedAt ?? "") ?? null,
      skipFlowTrigger: true,
      importSource: source,
      importBatchId,
    });
  } catch (error) {
    // The real DB-level unique constraint (storeId, importSource, externalId) is a
    // defense-in-depth backstop behind findExistingReview's own check-before-create — it should
    // only ever fire on a genuine race (two imports of the same file running concurrently), but
    // when it does, that's still just a duplicate, not a hard failure the whole row should error
    // out on.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { kind: "duplicate", tier: match.tier };
    }
    throw error;
  }

  if (media.valid.length > 0) {
    await prisma.reviewMedia.createMany({
      data: media.valid.map((url) => ({ reviewId: review.id, url, type: "IMAGE" as const })),
    });
  }

  return review.isPublished
    ? { kind: "imported", tier: match.tier, mediaImported: media.valid.length, mediaSkipped: media.skipped }
    : { kind: "pending", tier: match.tier, mediaImported: media.valid.length, mediaSkipped: media.skipped };
}

function emptyResult(totalRows: number, dryRun: boolean): ImportResult {
  return {
    totalRows,
    imported: 0,
    heldForModeration: 0,
    duplicates: 0,
    titlesRepaired: 0,
    missingProducts: [],
    ambiguousProducts: [],
    importedMedia: 0,
    skippedMedia: [],
    warnings: [],
    errors: [],
    dryRun,
    matchedRows: 0,
    unmatchedRows: 0,
    ambiguousRows: 0,
    duplicateRows: 0,
    invalidRows: 0,
    expectedImportedCount: 0,
    matchTierCounts: emptyMatchTierCounts(),
  };
}

// Cheap, DB-free first step of the wizard ("ANALYZE FILE") — reads only the header row via the
// chosen source's own Importer.detectColumns, so a merchant sees exactly which columns were
// auto-detected (and which required fields are still missing) before any product-matching or
// duplicate-checking work runs. No storeId needed at this stage — nothing here touches the
// database.
export function detectImportColumns(source: ImportSource, fileContent: string): ColumnDetectionResult {
  return getImporter(source).detectColumns(fileContent);
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
  filename: string | null = null,
  columnOverrides?: HeaderOverrides,
): Promise<ImportResult> {
  const logPrefix = `[import:${source}]${dryRun ? "[dry-run]" : ""} store=${storeId}`;
  const importer = getImporter(source);
  const { rows, fileErrors } = importer.parse(fileContent, columnOverrides);

  if (fileErrors.length > 0) {
    // File-level rejection (e.g. a required column genuinely missing) — logged distinctly from
    // per-row rejections below, since this means zero rows were even attempted, not that some
    // rows individually failed. Recorded in Import History too (a "failed" batch is still real
    // history a merchant benefits from seeing, not just a transient error message) — but only
    // for a real attempt, never for a dry run.
    console.error(`${logPrefix} file rejected before any row was processed:`, fileErrors);
    const result = emptyResult(0, dryRun);
    result.errors = fileErrors.map((reason) => ({ row: 0, reason }));
    result.invalidRows = result.errors.length;

    if (!dryRun) {
      await prisma.importBatch.create({
        data: {
          storeId,
          source,
          filename,
          totalRows: 0,
          status: "failed",
          errorDetail: JSON.parse(JSON.stringify({ fileErrors })),
        },
      });
    }

    return result;
  }

  console.log(`${logPrefix} starting — ${rows.length} row(s) parsed`);

  const matcher = await ProductMatcher.forStore(storeId);
  const result = emptyResult(rows.length, dryRun);

  // A dry run is a preview, not a real event worth appearing in Import History — only a real,
  // committed import creates a batch record. Created before any row is processed so every
  // review created below can carry a real importBatchId from the moment it exists, rather than
  // a second pass to backfill it after the fact.
  const batch = dryRun
    ? null
    : await prisma.importBatch.create({
        data: { storeId, source, filename, totalRows: rows.length, status: "processing" },
      });

  for (const row of rows) {
    const outcome = await importRow(storeId, row, matcher, admin, dryRun, source, batch?.id ?? null);

    if (outcome.kind !== "missing_product" && outcome.kind !== "ambiguous_product" && outcome.tier) {
      result.matchTierCounts[outcome.tier] += 1;
    }

    switch (outcome.kind) {
      case "imported":
        result.imported += 1;
        result.importedMedia += outcome.mediaImported;
        result.skippedMedia.push(...outcome.mediaSkipped);
        if (outcome.tier === "fuzzy") {
          result.warnings.push({ row: row.row, reason: `Matched "${row.product}" by approximate title similarity — verify this landed on the right product.` });
        }
        break;
      case "pending":
        result.imported += 1;
        result.heldForModeration += 1;
        result.importedMedia += outcome.mediaImported;
        result.skippedMedia.push(...outcome.mediaSkipped);
        if (outcome.tier === "fuzzy") {
          result.warnings.push({ row: row.row, reason: `Matched "${row.product}" by approximate title similarity — verify this landed on the right product.` });
        }
        break;
      case "duplicate":
        result.duplicates += 1;
        break;
      case "repaired":
        result.titlesRepaired += 1;
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
      case "ambiguous_product": {
        const issue = buildAmbiguousProductIssue(row, outcome.candidateProductIds);
        result.ambiguousProducts.push(issue);
        console.warn(`${logPrefix} row ${issue.row} ambiguous: ${issue.reason}`);
        break;
      }
      case "error":
        result.errors.push({ row: row.row, reason: outcome.reason });
        console.warn(`${logPrefix} row ${row.row} invalid: ${outcome.reason}`);
        break;
    }
  }

  result.unmatchedRows = result.missingProducts.length;
  result.ambiguousRows = result.ambiguousProducts.length;
  result.invalidRows = result.errors.length;
  // A repaired row is a duplicate that got its title backfilled — still counted as a
  // duplicate for the merchant-facing "X duplicates" total (it created no new review), with
  // titlesRepaired as its own additional, separately-reported detail.
  result.duplicateRows = result.duplicates + result.titlesRepaired;
  result.matchedRows = result.imported + result.duplicateRows + result.errors.length;
  result.expectedImportedCount = result.imported;

  console.log(
    `${logPrefix} complete — total=${result.totalRows} matched=${result.matchedRows} ` +
      `unmatched=${result.unmatchedRows} duplicates=${result.duplicateRows} invalid=${result.invalidRows} ` +
      `imported=${result.imported} heldForModeration=${result.heldForModeration} titlesRepaired=${result.titlesRepaired} ` +
      `tiers=${JSON.stringify(result.matchTierCounts)}`,
  );

  if (batch) {
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        imported: result.imported,
        duplicates: result.duplicateRows,
        heldForModeration: result.heldForModeration,
        unmatchedRows: result.unmatchedRows,
        invalidRows: result.invalidRows,
        status: "completed",
        // Plain-object interfaces don't structurally satisfy Prisma's InputJsonValue type
        // (it wants an index signature); a JSON round-trip is the standard, safe way to hand
        // an already-JSON-safe value (no Date/undefined/class instances here) to a Json column.
        errorDetail: JSON.parse(
          JSON.stringify({
            missingProducts: result.missingProducts,
            ambiguousProducts: result.ambiguousProducts,
            skippedMedia: result.skippedMedia,
            errors: result.errors,
            warnings: result.warnings,
          }),
        ),
      },
    });
    result.importBatchId = batch.id;
  }

  return result;
}

// Undoes exactly one import batch's own rows — never a broader delete. Scoped by both
// importBatchId AND storeId (a defense-in-depth belt-and-suspenders check: importBatchId alone
// is already globally unique, but requiring storeId too means a cross-tenant id can never be
// undone even if one were somehow guessed/leaked). Soft-deletes via the same deletedAt
// mechanism every other review deletion in this app already uses — an undone import is
// recoverable in principle (support could un-soft-delete), not a hard, unrecoverable erase.
// Refuses to run a second time on an already-undone batch (status stays authoritative), and
// refuses entirely once real merchant activity (approve/reject/reply/helpful vote) could have
// happened — see the isSafeToUndo check in the caller for that decision; this function itself
// only performs the mechanical part once a caller has already decided it's safe.
export async function undoImportBatch(storeId: string, importBatchId: string): Promise<{ restored: number }> {
  const batch = await prisma.importBatch.findFirst({ where: { id: importBatchId, storeId } });
  if (!batch) {
    throw new Error("Import batch not found.");
  }
  if (batch.status === "undone") {
    throw new Error("This import has already been undone.");
  }

  const { count } = await prisma.review.updateMany({
    where: { storeId, importBatchId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  await prisma.importBatch.update({
    where: { id: importBatchId },
    data: { status: "undone", undoneAt: new Date() },
  });

  await recordDataAccess({
    storeId,
    actor: "admin:import_undo",
    action: "undo",
    resource: "review.import_batch",
    success: true,
    detail: `batch ${importBatchId}: ${count} review(s) soft-deleted`,
  });

  return { restored: count };
}

export async function listImportBatches(storeId: string, limit: number = 50) {
  return prisma.importBatch.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getImportBatch(storeId: string, importBatchId: string) {
  return prisma.importBatch.findFirst({ where: { id: importBatchId, storeId } });
}

// CSV injection (aka "formula injection") protection — OWASP's standard mitigation: a cell
// value that OPENS with a character a spreadsheet application treats as a formula prefix
// (=, +, -, @, or a raw tab/carriage-return that can smuggle one after a delimiter) gets a
// leading apostrophe, which every major spreadsheet app renders as literal text, not a
// formula. Applied to every free-text field a merchant or the source platform authored — the
// content/reviewer fields the exact "IMAGYN Reviews > Export > merchant re-opens their own
// file in Excel" path a malicious review could otherwise exploit.
const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;
function sanitizeCsvCell(value: string): string {
  return FORMULA_PREFIX_PATTERN.test(value) ? `'${value}` : value;
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

// A basic DLP control, not a real-world limitation — no Imagyn store has ever had a review
// count anywhere near this in production. Bounds how much reviewer contact data (name/email)
// a single CSV export can pull out of the database in one call, so an unbounded export can
// never happen even if triggered many times or against an unexpectedly large store. Exported
// rows are still ordered oldest-first (unchanged), so a capped export is always "the first N
// reviews," a stable and reproducible subset, not an arbitrary one.
export const MAX_EXPORT_ROWS = 10_000;

export interface ExportReviewsResult {
  csv: string;
  totalCount: number;
  exportedCount: number;
  truncated: boolean;
}

// The per-call MAX_EXPORT_ROWS cap above bounds one export, but does nothing to stop the same
// cap being defeated by calling this repeatedly — a real gap in "prevents a bad actor from
// extracting data" (Shopify's own Q12 DLP wording), not a hypothetical one. Reuses the
// already-existing AuditLog table this function already writes to, rather than adding a new
// dependency (Redis, a rate-limiting library, etc.) for what a simple lookback count already
// answers. 10 exports/hour is deliberately generous for real merchant use (re-exporting after
// fixing a filter, testing, etc.) while still stopping a scripted/automated extraction loop,
// which would otherwise be able to pull an effectively unbounded amount of reviewer contact
// data by calling this in a tight loop.
export const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const EXPORT_RATE_LIMIT_MAX = 10;

export class ExportRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRateLimitError";
  }
}

// Uses the same column names importReviews accepts, so an exported file can be re-imported
// (into this store or another) without edits. Includes product_id/product_handle alongside the
// display-only product title, so a re-import always resolves at tier 1 or tier 3 of the
// matcher instead of falling back to title matching, and external_id so a re-import of an
// exported file is itself idempotent.
export async function exportReviewsToCsv(storeId: string, now: Date = new Date()): Promise<ExportReviewsResult> {
  const windowStart = new Date(now.getTime() - EXPORT_RATE_LIMIT_WINDOW_MS);
  const recentExportCount = await prisma.auditLog.count({
    where: { storeId, actor: "admin:csv_export", action: "export", success: true, createdAt: { gte: windowStart } },
  });

  if (recentExportCount >= EXPORT_RATE_LIMIT_MAX) {
    await recordDataAccess({
      storeId,
      actor: "admin:csv_export",
      action: "export",
      resource: "review.contact_fields",
      success: false,
      detail: `blocked — ${recentExportCount} exports already in the last hour (max ${EXPORT_RATE_LIMIT_MAX})`,
    });
    throw new ExportRateLimitError(
      "Too many exports for this store in the last hour. Please wait before exporting again.",
    );
  }

  const [totalCount, reviews] = await Promise.all([
    prisma.review.count({ where: { storeId, deletedAt: null } }),
    prisma.review.findMany({
      where: { storeId, deletedAt: null },
      include: { product: { select: { name: true, shopifyProductId: true, handle: true } } },
      orderBy: { createdAt: "asc" },
      take: MAX_EXPORT_ROWS,
    }),
  ]);

  const data = reviews.map((review) => ({
    product: sanitizeCsvCell(review.product?.name ?? review.productTitle ?? ""),
    product_id: review.product?.shopifyProductId ?? "",
    product_handle: review.product?.handle ?? "",
    rating: review.rating,
    title: sanitizeCsvCell(review.title ?? ""),
    content: sanitizeCsvCell(review.content),
    reviewer_name: sanitizeCsvCell(review.reviewerName),
    reviewer_email: review.reviewerEmail ?? "",
    reviewer_location: sanitizeCsvCell(review.reviewerLocation ?? ""),
    verified_purchase: review.verifiedPurchase ? "true" : "false",
    created_at: review.createdAt.toISOString(),
    status: review.status,
    external_id: review.externalId ?? "",
    reply: sanitizeCsvCell(review.reply ?? ""),
    reply_date: review.repliedAt?.toISOString() ?? "",
  }));

  const truncated = totalCount > reviews.length;

  // A meaningful bulk-export of reviewer contact fields (reviewer_email is a real column
  // above) — exactly the kind of protected-data access worth an audit trail, unlike a single
  // review's own read in the admin list/detail view. Row count only, never which rows or
  // any of their content.
  await recordDataAccess({
    storeId,
    actor: "admin:csv_export",
    action: "export",
    resource: "review.contact_fields",
    success: true,
    detail: truncated
      ? `${reviews.length} of ${totalCount} row(s) (capped at ${MAX_EXPORT_ROWS})`
      : `${reviews.length} row(s)`,
  });

  return {
    csv: Papa.unparse({ fields: [...EXPORT_COLUMNS], data }),
    totalCount,
    exportedCount: reviews.length,
    truncated,
  };
}
