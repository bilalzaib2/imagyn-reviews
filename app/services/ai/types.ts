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

// Every provider (OpenAI, Anthropic, Gemini — see openai.server.ts / anthropic.server.ts /
// gemini.server.ts) implements exactly this shape. aiSummary.server.ts, the only caller,
// depends on this interface and never on a specific provider's SDK/request format — that's
// what makes switching providers a config change (AI_PROVIDER env var) instead of a code
// change. UI components never import from this directory at all.
export interface AiProvider {
  readonly name: string;
  generateReviewSummary(request: AiSummaryRequest): Promise<AiSummaryResult>;
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
