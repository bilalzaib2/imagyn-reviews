// Imagyn Reviews — Brand Studio V2's AI-generated suggestion layer.
//
// Deliberately narrow: suggests only an accent color (colors.starColor) and a typography feel
// (typography.scale + typography.letterSpacing), the two categories app.appearance.tsx's
// manual color/typography controls also cover. Not a full AppearanceTokens generator: card
// style, spacing, logo, and URL analysis are explicitly out of scope for this pass, per the
// Phase 3 brief. (There is no deterministic "Brand Match" counterpart — Shopify's Admin API
// has no reliable, universal way to read a merchant's brand color/logo; see
// app.appearance.tsx's applyEmailBranding intent and docs/DECISIONS.md.)
//
// A thin wrapper over the shared multi-provider AI abstraction (app/services/ai/), the same
// pattern aiSummary.server.ts already establishes — this file owns no prompt/parsing logic of
// its own (that lives in app/services/ai/shared.ts, shared across all three providers) and, unlike
// aiSummary.server.ts, persists nothing: the suggestion is applied to the merchant's *draft*
// tokens client-side (app.appearance.tsx), and only becomes real once the merchant clicks the
// existing Save action.
import { getAiProvider } from "./ai/provider.server";

export interface BrandSuggestion {
  starColor: string;
  typography: { scale: number; letterSpacing: "tight" | "normal" };
  rationale: string;
  provider: string;
  modelUsed: string;
}

export async function generateAiBrandSuggestion(input: {
  shopName: string;
  detectedColor: string | null;
}): Promise<BrandSuggestion> {
  const provider = getAiProvider();
  const result = await provider.generateBrandSuggestion({
    shopName: input.shopName,
    detectedColor: input.detectedColor,
  });

  return { ...result, provider: provider.name };
}
