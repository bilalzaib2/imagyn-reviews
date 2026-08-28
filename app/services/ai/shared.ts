import {
  AiProviderError,
  type AiBrandSuggestionRequest,
  type AiBrandSuggestionResult,
  type AiSummaryRequest,
  type AiSummaryResult,
} from "./types";

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
// output. Exported for reuse by parseBrandSuggestionJson below (same defensive need, same
// fix), not just parseAiSummaryJson.
export function extractJsonObject(raw: string): string {
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

const BRAND_SUGGESTION_JSON_SHAPE = `Respond with strict JSON only, matching exactly this shape (no markdown fences, no commentary outside the JSON):
{
  "starColor": string,       // a 6-digit hex color, e.g. "#2B2B2B" — the one accent color used for star ratings
  "scale": number,           // 0.9-1.15 — a font-size multiplier; 1 is the default/neutral size
  "letterSpacing": string,   // exactly "tight" or "normal"
  "rationale": string        // one short sentence explaining the choice, in plain language for a merchant
}`;

// Deliberately the narrowest possible brief — accent color + typography only, matching
// exactly what this feature is scoped to (see AiBrandSuggestionRequest's own comment). The
// model is explicitly told not to invent brand facts it wasn't given.
export function buildBrandSuggestionSystemPrompt(): string {
  return (
    "You are a minimal, premium brand-design assistant for a Shopify reviews app. Given a " +
    "merchant's shop name and, optionally, a brand color already detected from their Shopify " +
    "brand settings, suggest ONE accent color (used only for star ratings) and a typography " +
    "feel (font-size scale and letter spacing) for their review widgets. Favor calm, " +
    "restrained, Apple-inspired choices — never a loud or saturated color, never an extreme " +
    "scale or spacing value. If a brand color was given, your suggestion should complement or " +
    "refine it, not replace it with something unrelated. Do not invent facts about the " +
    "merchant or their products; base the suggestion only on the shop name and brand color " +
    "provided. " +
    BRAND_SUGGESTION_JSON_SHAPE
  );
}

export function buildBrandSuggestionUserPrompt(request: AiBrandSuggestionRequest): string {
  return (
    `Shop name: ${request.shopName}\n` +
    `Detected brand color: ${request.detectedColor ?? "none — no brand color configured in Shopify"}`
  );
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Unlike parseAiSummaryJson, out-of-range/malformed individual fields are clamped or
// rejected outright rather than silently substituted — a fabricated color or spacing value
// would be worse than a clear error here (see AiProviderError usage below), matching this
// feature's "no invented data" requirement.
export function parseBrandSuggestionJson(
  raw: string,
  providerName: string,
): Omit<AiBrandSuggestionResult, "modelUsed"> {
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

  const starColor = typeof candidate.starColor === "string" ? candidate.starColor.trim() : "";
  if (!HEX_COLOR_PATTERN.test(starColor)) {
    throw new AiProviderError(`${providerName} returned an invalid accent color.`, providerName);
  }

  const rawScale = typeof candidate.scale === "number" ? candidate.scale : Number(candidate.scale);
  if (!Number.isFinite(rawScale)) {
    throw new AiProviderError(`${providerName} returned an invalid typography scale.`, providerName);
  }
  // Clamped, not rejected — a model returning 0.87 or 1.2 is still a real, meaningful
  // suggestion just outside the slider's bounds, not a fabrication.
  const scale = Math.min(1.15, Math.max(0.9, rawScale));

  const letterSpacing = candidate.letterSpacing === "tight" || candidate.letterSpacing === "normal"
    ? candidate.letterSpacing
    : null;
  if (!letterSpacing) {
    throw new AiProviderError(`${providerName} returned an invalid letter spacing value.`, providerName);
  }

  const rationale = typeof candidate.rationale === "string" ? candidate.rationale.trim() : "";

  return { starColor, typography: { scale, letterSpacing }, rationale };
}
