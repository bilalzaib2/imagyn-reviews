export interface AiSummaryReviewInput {
  rating: number;
  title: string | null;
  content: string;
}

export interface AiSummaryRequest {
  productName: string;
  reviews: AiSummaryReviewInput[];
  // "product" (default, omitted by every existing caller) frames the prompt around a single
  // product; "store" frames it around a store's full catalog of approved reviews spanning many
  // products — see aiSummary.server.ts's regenerateStoreAiSummary. Same request/response shape
  // either way (same architecture, same provider, same JSON contract) — only the prompt framing
  // changes, per the explicit requirement not to introduce a second AI architecture for this.
  scope?: "product" | "store";
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

// A merchant-facing draft only — never sent automatically. See aiReplyDraft.server.ts's own
// comment for why this stays a suggestion the merchant must review/edit/submit through the
// existing replyToReview action, exactly like every other reply in this app.
export interface AiReplyDraftRequest {
  productName: string;
  review: AiSummaryReviewInput;
  // The merchant's own in-progress draft, if they'd already started typing one before asking
  // for AI help — when present, the model revises/polishes it instead of starting from a
  // blank page, so "Draft with AI" is useful both as a first draft and as a rewrite tool.
  existingDraft: string | null;
}

export interface AiReplyDraftResult {
  draft: string;
  modelUsed: string;
}

// Every provider (OpenAI, Anthropic, Gemini — see openai.server.ts / anthropic.server.ts /
// gemini.server.ts) implements exactly this shape. aiSummary.server.ts/brandSuggestion.server.ts/
// aiReplyDraft.server.ts, the only callers, depend on this interface and never on a specific
// provider's SDK/request format — that's what makes switching providers a config change
// (AI_PROVIDER env var) instead of a code change. UI components never import from this
// directory at all.
export interface AiProvider {
  readonly name: string;
  generateReviewSummary(request: AiSummaryRequest): Promise<AiSummaryResult>;
  generateBrandSuggestion(request: AiBrandSuggestionRequest): Promise<AiBrandSuggestionResult>;
  generateReplyDraft(request: AiReplyDraftRequest): Promise<AiReplyDraftResult>;
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
