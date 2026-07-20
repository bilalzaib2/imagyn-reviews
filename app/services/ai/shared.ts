import { AiProviderError, type AiSummaryRequest, type AiSummaryResult } from "./types";

const JSON_SHAPE_DESCRIPTION = `Respond with strict JSON only, matching exactly this shape (no markdown fences, no commentary outside the JSON):
{
  "summary": string,        // <= 120 words, a synthesized overview of what customers actually say
  "positives": string[],    // 2-5 short phrases, the most common praise
  "negatives": string[],    // 0-5 short phrases, the most common complaints (empty array if none)
  "recommendation": string  // one short sentence: who this product is best for
}`;

// Shared by every provider so the model always sees the same instructions regardless of
// which one is configured — the prompt is not something that should vary provider to
// provider, only the transport/request format does.
export function buildSystemPrompt(): string {
  return (
    "You are a precise product review analyst. Given a set of customer reviews for a " +
    "single product, identify genuine patterns across them — do not simply describe or " +
    "average the star ratings. Base every statement strictly on what the reviews actually " +
    "say; never invent details, features, or complaints that aren't present in the text. " +
    "If the reviews are mixed or too few to find a clear pattern, say so plainly rather " +
    "than inventing a false consensus. Be concise and specific, not generic marketing " +
    "language. " +
    JSON_SHAPE_DESCRIPTION
  );
}

export function buildUserPrompt(request: AiSummaryRequest): string {
  const reviewLines = request.reviews
    .map((review, index) => {
      const title = review.title ? ` — "${review.title}"` : "";
      return `${index + 1}. [${review.rating}/5]${title} ${review.content}`;
    })
    .join("\n");

  return `Product: ${request.productName}\n\nCustomer reviews (${request.reviews.length} total):\n${reviewLines}`;
}

// Some models wrap JSON in markdown fences or add stray text despite instructions not to
// — this extracts the first {...} block rather than failing outright on otherwise-usable
// output.
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return trimmed;
  }
  return trimmed.slice(start, end + 1);
}

export function parseAiSummaryJson(raw: string, providerName: string): Omit<AiSummaryResult, "modelUsed"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new AiProviderError(`${providerName} returned a response that wasn't valid JSON.`, providerName);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AiProviderError(`${providerName} returned an unexpected response shape.`, providerName);
  }

  const candidate = parsed as Record<string, unknown>;
  const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
  const recommendation = typeof candidate.recommendation === "string" ? candidate.recommendation.trim() : "";
  const positives = Array.isArray(candidate.positives)
    ? candidate.positives.filter((value): value is string => typeof value === "string")
    : [];
  const negatives = Array.isArray(candidate.negatives)
    ? candidate.negatives.filter((value): value is string => typeof value === "string")
    : [];

  if (!summary) {
    throw new AiProviderError(`${providerName} response was missing a summary.`, providerName);
  }

  return { summary, positives, negatives, recommendation };
}
