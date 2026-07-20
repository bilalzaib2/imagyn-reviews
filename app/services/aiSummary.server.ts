import prisma from "../db.server";
import { getAiProvider } from "./ai/provider.server";
import { ReviewStatus } from "./review.shared";

export interface ProductAiSummaryRecord {
  id: string;
  productId: string;
  summary: string;
  positives: string[];
  negatives: string[];
  recommendation: string;
  reviewCountUsed: number;
  provider: string;
  modelUsed: string;
  generatedAt: Date;
  updatedAt: Date;
}

// Reviews are capped per summary to keep the prompt (and cost/latency) bounded — the most
// recent APPROVED reviews are the most representative of the product's current state
// anyway. reviewCountUsed always reflects exactly how many were actually sent, never a
// separate "total approved" figure, so the admin's "Reviews analyzed" count is honest.
const MAX_REVIEWS_PER_SUMMARY = 100;

// How many new APPROVED reviews must accumulate since the last generation before an
// automatic regeneration fires. Configurable via env so this can be tuned without a code
// change, per the "keep this configurable" requirement.
const DEFAULT_REGENERATION_THRESHOLD = 5;

function getRegenerationThreshold(): number {
  const configured = Number(process.env.AI_SUMMARY_REGENERATION_THRESHOLD);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REGENERATION_THRESHOLD;
}

function safeParseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(row: {
  id: string;
  productId: string;
  summary: string;
  positives: string;
  negatives: string;
  recommendation: string;
  reviewCountUsed: number;
  provider: string;
  modelUsed: string;
  generatedAt: Date;
  updatedAt: Date;
}): ProductAiSummaryRecord {
  return {
    id: row.id,
    productId: row.productId,
    summary: row.summary,
    positives: safeParseStringArray(row.positives),
    negatives: safeParseStringArray(row.negatives),
    recommendation: row.recommendation,
    reviewCountUsed: row.reviewCountUsed,
    provider: row.provider,
    modelUsed: row.modelUsed,
    generatedAt: row.generatedAt,
    updatedAt: row.updatedAt,
  };
}

// Pure cache read — the only function any read-only surface (the storefront widget, the
// admin display) should call. Never triggers generation and never makes a network call,
// so nothing that calls this can ever be slowed down or blocked by AI latency.
export async function getAiSummary(productId: string): Promise<ProductAiSummaryRecord | null> {
  const row = await prisma.productAiSummary.findUnique({ where: { productId } });
  return row ? toRecord(row) : null;
}

async function getApprovedReviewCount(productId: string): Promise<number> {
  return prisma.review.count({ where: { productId, deletedAt: null, status: ReviewStatus.APPROVED } });
}

// The actual generation path. Callers: the admin's explicit "Regenerate AI Summary"
// action (always runs when clicked) and maybeAutoRegenerateAiSummary below (only past its
// own threshold check). Never called from a storefront-facing loader — this is the one
// function in the whole feature that actually talks to an AI provider.
export async function regenerateAiSummary(productId: string): Promise<ProductAiSummaryRecord> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });

  if (!product) {
    throw new Error("Product not found.");
  }

  const reviews = await prisma.review.findMany({
    where: { productId, deletedAt: null, status: ReviewStatus.APPROVED },
    select: { rating: true, title: true, content: true },
    orderBy: { createdAt: "desc" },
    take: MAX_REVIEWS_PER_SUMMARY,
  });

  if (reviews.length === 0) {
    throw new Error("This product has no approved reviews to summarize yet.");
  }

  const provider = getAiProvider();
  const result = await provider.generateReviewSummary({ productName: product.name, reviews });

  const row = await prisma.productAiSummary.upsert({
    where: { productId },
    update: {
      summary: result.summary,
      positives: JSON.stringify(result.positives),
      negatives: JSON.stringify(result.negatives),
      recommendation: result.recommendation,
      reviewCountUsed: reviews.length,
      provider: provider.name,
      modelUsed: result.modelUsed,
      generatedAt: new Date(),
    },
    create: {
      productId,
      summary: result.summary,
      positives: JSON.stringify(result.positives),
      negatives: JSON.stringify(result.negatives),
      recommendation: result.recommendation,
      reviewCountUsed: reviews.length,
      provider: provider.name,
      modelUsed: result.modelUsed,
    },
  });

  return toRecord(row);
}

// Fire-and-forget: called without awaiting from review.server.ts whenever a review is
// approved, so a merchant's moderation click never waits on an AI call ("never block the
// page" applied to the admin, not just the storefront). Only regenerates once enough new
// approved reviews have accumulated since the last generation, or if no summary exists
// yet at all — never runs unconditionally on every mutation.
export async function maybeAutoRegenerateAiSummary(productId: string): Promise<void> {
  try {
    const [existing, approvedCount] = await Promise.all([
      prisma.productAiSummary.findUnique({ where: { productId }, select: { reviewCountUsed: true } }),
      getApprovedReviewCount(productId),
    ]);

    if (approvedCount === 0) {
      return;
    }

    const newReviewsSinceLastGeneration = approvedCount - (existing?.reviewCountUsed ?? 0);
    const shouldRegenerate = !existing || newReviewsSinceLastGeneration >= getRegenerationThreshold();

    if (!shouldRegenerate) {
      return;
    }

    await regenerateAiSummary(productId);
  } catch (error) {
    // Never let a background summary failure surface as a moderation-action error — the
    // merchant's approve/reject request already completed before this runs.
    console.error("[aiSummary] auto-regeneration failed:", error instanceof Error ? error.message : error);
  }
}
