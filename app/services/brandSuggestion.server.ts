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
import { checkStarLegibility, getDefaultAppearanceTokens } from "./appearance.shared";
import { getStorePalette, isDarkBackground } from "./storePalette.server";

export interface BrandSuggestion {
  starColor: string;
  typography: { scale: number; letterSpacing: "tight" | "normal" };
  rationale: string;
  provider: string;
  modelUsed: string;
}

/**
 * Replaces a star color that would render the rating unreadable with the default amber.
 *
 * A suggestion is applied to the merchant's draft tokens with one click, so an illegible
 * accent becomes their live storefront as soon as they hit Save. The model is now asked for a
 * readable hue (buildBrandSuggestionSystemPrompt), but a prompt is guidance, not a guarantee:
 * before this guard existed, one live store was suggested — and shipped — #B0B0B0 stars,
 * which are indistinguishable from the grey unfilled stars beside them.
 *
 * Substituting rather than throwing, and saying so in the rationale, is deliberate. The rest
 * of the suggestion (typography, and the reasoning behind it) is still useful, and an error
 * toast would leave the merchant with nothing; silently applying grey stars would be worse
 * than either. Judged against the DEFAULT surface, which is what this service knows — the
 * merchant's own surface color is checked separately, and continuously, by
 * checkAppearanceContrast against their live draft in app.appearance.tsx.
 */
function withLegibleStarColor(result: {
  starColor: string;
  typography: { scale: number; letterSpacing: "tight" | "normal" };
  rationale: string;
  modelUsed: string;
}) {
  const defaults = getDefaultAppearanceTokens().colors;
  const issue = checkStarLegibility(result.starColor, defaults.surfaceColor, defaults.starEmptyColor);
  if (!issue) return result;

  const note =
    issue.reason === "invisible-on-surface"
      ? `Used the default star color instead of ${result.starColor}, which would be almost invisible on a white review card.`
      : `Used the default star color instead of ${result.starColor}, which is too close to grey to tell a filled star from an empty one.`;

  return {
    ...result,
    starColor: defaults.starColor,
    rationale: result.rationale ? `${result.rationale} ${note}` : note,
  };
}

export async function generateAiBrandSuggestion(input: {
  shopName: string;
  detectedColor: string | null;
  /** The merchant's myshopify domain, used to read their live storefront's palette. */
  shopDomain?: string | null;
}): Promise<BrandSuggestion> {
  const provider = getAiProvider();

  // Read what the store actually looks like before asking for a suggestion. This is what
  // makes the result match their brand rather than their shop name: without it the model is
  // given a name and nothing else. Failure is fine and expected (a password-protected store,
  // a slow storefront, a theme with no named brand colour) — getStorePalette returns null and
  // the prompt is told plainly that nothing could be read.
  const palette = input.shopDomain ? await getStorePalette(input.shopDomain) : null;

  const result = await provider.generateBrandSuggestion({
    shopName: input.shopName,
    detectedColor: input.detectedColor,
    storeAccent: palette?.accent ?? null,
    storeBackground: palette?.background ?? null,
    storeIsDark: isDarkBackground(palette?.background ?? null),
  });

  return { ...withLegibleStarColor(result), provider: provider.name };
}
