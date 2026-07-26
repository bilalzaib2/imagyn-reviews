import Papa from "papaparse";
import prisma from "../db.server";
import { createReview } from "./review.server";
import { getImporter } from "./importers/provider.server";
import type { ImportSource, ParsedReviewRow } from "./importers/types";

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResult {
  totalRows: number;
  imported: number;
  duplicates: number;
  heldForModeration: number;
  errors: ImportRowError[];
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
  // Reviews arriving via CSV import were already vetted on whatever platform they came
  // from, so the default (no status column, or "approved") is to publish immediately —
  // unlike a customer submission, which always starts PENDING. Only an explicit "pending" /
  // "rejected" value holds a row back for moderation.
  const normalized = raw.trim().toLowerCase();
  return normalized === "" || normalized === "approved" || normalized === "published" || parseBoolean(raw);
}

async function resolveProductId(storeId: string, identifier: string): Promise<string | null> {
  const product = await prisma.product.findFirst({
    where: {
      storeId,
      OR: [{ handle: identifier }, { name: { equals: identifier } }],
    },
    select: { id: true },
  });

  return product?.id ?? null;
}

async function isDuplicate(storeId: string, productId: string, reviewerName: string, content: string) {
  const existing = await prisma.review.findFirst({
    where: { storeId, productId, reviewerName, content, deletedAt: null },
    select: { id: true },
  });

  return Boolean(existing);
}

async function importRow(storeId: string, row: ParsedReviewRow): Promise<"imported" | "duplicate" | "pending" | ImportRowError> {
  const productId = row.product ? await resolveProductId(storeId, row.product) : null;
  if (!productId) {
    return { row: row.row, reason: `Product not found: "${row.product || "(blank)"}".` };
  }

  const rating = parseRating(row.rating);
  if (rating === null) {
    return { row: row.row, reason: `Rating must be a whole number between ${RATING_MIN} and ${RATING_MAX} (got "${row.rating}").` };
  }

  if (!row.content) {
    return { row: row.row, reason: "Review content is required." };
  }

  const reviewerName = row.reviewerName || "Anonymous";

  if (await isDuplicate(storeId, productId, reviewerName, row.content)) {
    return "duplicate";
  }

  const review = await createReview({
    productId,
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

  return review.isPublished ? "imported" : "pending";
}

// The only DB-aware entry point for imports — parses via whichever Importer the source maps
// to (see importers/provider.server.ts), then validates, dedupes, and creates one row at a
// time so a single bad row never aborts the batch.
export async function importReviews(storeId: string, source: ImportSource, fileContent: string): Promise<ImportResult> {
  const importer = getImporter(source);
  const { rows, fileErrors } = importer.parse(fileContent);

  if (fileErrors.length > 0) {
    return { totalRows: 0, imported: 0, duplicates: 0, heldForModeration: 0, errors: fileErrors.map((reason) => ({ row: 0, reason })) };
  }

  const result: ImportResult = { totalRows: rows.length, imported: 0, duplicates: 0, heldForModeration: 0, errors: [] };

  for (const row of rows) {
    const outcome = await importRow(storeId, row);

    if (outcome === "imported") {
      result.imported += 1;
    } else if (outcome === "pending") {
      result.imported += 1;
      result.heldForModeration += 1;
    } else if (outcome === "duplicate") {
      result.duplicates += 1;
    } else {
      result.errors.push(outcome);
    }
  }

  return result;
}

const EXPORT_COLUMNS = [
  "product",
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
// (into this store or another) without edits.
export async function exportReviewsToCsv(storeId: string): Promise<string> {
  const reviews = await prisma.review.findMany({
    where: { storeId, deletedAt: null },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const data = reviews.map((review) => ({
    product: review.product?.name ?? review.productTitle ?? "",
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
