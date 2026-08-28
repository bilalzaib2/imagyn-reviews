export interface AiSummaryReviewInput {
  rating: number;
  title: string | null;
  content: string;
}

export interface AiSummaryRequest {
  productName: string;
  reviews: AiSummaryReviewInput[];
}

export interface AiSummaryResult {
  summary: string;
  positives: string[];
  negatives: string[];
  recommendation: string;
  modelUsed: string;
}

// Brand Studio V2's AI suggestion layer — deliberately narrow (accent color + typography
// only). Not a full AppearanceTokens generator: card style, spacing, logo, and layout stay
// untouched by this.
export interface AiBrandSuggestionRequest {
  shopName: string;
  // Optional known brand color, given as context so the AI can complement/refine it rather
  // than suggesting something unrelated. Currently always null — Shopify's Admin API has no
  // reliable, universal way to detect a merchant's brand color (see app.appearance.tsx).
  // Kept as a parameter rather than removed: a future legitimate source (e.g. the merchant's
  // own already-configured Imagyn accent color) can populate it without an API change.
  detectedColor: string | null;
}

export interface AiBrandSuggestionResult {
  starColor: string;
  typography: { scale: number; letterSpacing: "tight" | "normal" };
  rationale: string;
  modelUsed: string;
}

// Every provider (OpenAI, Anthropic, Gemini — see openai.server.ts / anthropic.server.ts /
// gemini.server.ts) implements exactly this shape. aiSummary.server.ts/brandSuggestion.server.ts,
// the only callers, depend on this interface and never on a specific provider's SDK/request
// format — that's what makes switching providers a config change (AI_PROVIDER env var)
// instead of a code change. UI components never import from this directory at all.
export interface AiProvider {
  readonly name: string;
  generateReviewSummary(request: AiSummaryRequest): Promise<AiSummaryResult>;
  generateBrandSuggestion(request: AiBrandSuggestionRequest): Promise<AiBrandSuggestionResult>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
