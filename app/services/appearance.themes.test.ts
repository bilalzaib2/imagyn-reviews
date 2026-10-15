// Every pre-built theme must be readable. This is the guardrail for a curated list: the AI
// brand suggestion already shipped #B0B0B0 stars to a live store once, and a hand-written
// theme can make exactly the same mistake with none of the AI's excuse.
import { describe, expect, it } from "vitest";
import { appearanceThemes } from "./appearance.themes";
import {
  WCAG_AA_MIN_CONTRAST,
  checkStarLegibility,
  contrastRatio,
  flattenOntoSurface,
  getDefaultAppearanceTokens,
  mergeAppearanceTokens,
} from "./appearance.shared";

describe("pre-built themes", () => {
  it("ships at least a few, each with a unique id", () => {
    const ids = appearanceThemes.map((theme) => theme.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const theme of appearanceThemes) {
    describe(theme.label, () => {
      const colors = theme.tokens.colors;

      it("defines a complete palette rather than inheriting half of one", () => {
        expect(colors).toBeDefined();
        expect(colors?.starColor).toBeTruthy();
        expect(colors?.surfaceColor).toBeTruthy();
        expect(colors?.starEmptyColor).toBeTruthy();
        expect(colors?.textColor).toBeTruthy();
      });

      it("renders a rating a shopper can actually read", () => {
        expect(
          checkStarLegibility(colors!.starColor, colors!.surfaceColor, colors!.starEmptyColor),
        ).toBeNull();
      });

      it("clears WCAG AA for body text on its own surface", () => {
        const ratio = contrastRatio(colors!.textColor!, colors!.surfaceColor);
        expect(ratio).not.toBeNull();
        expect(ratio!).toBeGreaterThanOrEqual(WCAG_AA_MIN_CONTRAST);
      });

      it("keeps the unfilled star visible against its own surface", () => {
        // A dark theme that kept the default translucent-black unfilled star would composite
        // it to near-black and lose it entirely — the empty half of the rating has to read.
        const empty = flattenOntoSurface(colors!.starEmptyColor, colors!.surfaceColor);
        expect(empty).not.toBeNull();
        const ratio = contrastRatio(empty!, colors!.surfaceColor);
        expect(ratio).not.toBeNull();
        expect(ratio!).toBeGreaterThan(1.05);
      });

      it("never overwrites the merchant's logo", () => {
        // The logo is merchant identity, not styling. Applying a theme must not drop it.
        expect(theme.tokens.images).toBeUndefined();
      });

      it("merges onto existing tokens without leaving any category undefined", () => {
        const merged = mergeAppearanceTokens(theme.tokens, getDefaultAppearanceTokens());
        for (const category of Object.keys(getDefaultAppearanceTokens())) {
          expect(merged[category as keyof typeof merged]).toBeDefined();
        }
      });

      it("preserves a logo the merchant already uploaded", () => {
        const current = getDefaultAppearanceTokens();
        current.images.logoUrl = "https://cdn.shopify.com/logo.png";
        const merged = mergeAppearanceTokens(theme.tokens, current);

        expect(merged.images.logoUrl).toBe("https://cdn.shopify.com/logo.png");
      });
    });
  }
});
