import { describe, expect, it } from "vitest";
import {
  checkAppearanceContrast,
  checkStarLegibility,
  contrastRatio,
  flattenOntoSurface,
  getDefaultAppearanceTokens,
  mergeAppearanceTokens,
} from "./appearance.shared";

describe("getDefaultAppearanceTokens — logo", () => {
  it("defaults to no logo", () => {
    expect(getDefaultAppearanceTokens().images.logoUrl).toBeNull();
  });
});

describe("mergeAppearanceTokens — logo", () => {
  it("a partial with only images.logoUrl set doesn't disturb any other category", () => {
    const merged = mergeAppearanceTokens({ images: { logoUrl: "https://example.com/logo.png" } });

    expect(merged.images.logoUrl).toBe("https://example.com/logo.png");
    expect(merged.colors).toEqual(getDefaultAppearanceTokens().colors);
    expect(merged.typography).toEqual(getDefaultAppearanceTokens().typography);
  });

  it("a Widget Style preset (no images key at all) leaves an existing logo untouched", () => {
    const currentDraft = { ...getDefaultAppearanceTokens(), images: { logoUrl: "https://example.com/logo.png" } };
    const merged = mergeAppearanceTokens({ corners: { radius: 4 } }, currentDraft);

    expect(merged.images.logoUrl).toBe("https://example.com/logo.png");
    expect(merged.corners.radius).toBe(4);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for pure black on pure white — the real maximum WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("is 1:1 for identical colors", () => {
    expect(contrastRatio("#f5a623", "#f5a623")).toBeCloseTo(1, 5);
  });

  it("returns null for a color it can't parse, never a fabricated number", () => {
    expect(contrastRatio("not-a-color", "#ffffff")).toBeNull();
  });
});

describe("checkAppearanceContrast", () => {
  it("has no warnings for the documented defaults", () => {
    const warnings = checkAppearanceContrast(getDefaultAppearanceTokens());
    // The shipped defaults must come up clean. The conventional amber star (#f5a623) scores
    // only 2.0:1 against a white card by luminance, so a text-contrast rule applied to it
    // showed every merchant on default settings a warning they could not clear with any
    // amber — see checkStarLegibility for why that was the wrong measurement.
    expect(warnings).toEqual([]);
  });

  it("warns when the merchant's own chosen text color is unreadable against their own surface", () => {
    const tokens = {
      ...getDefaultAppearanceTokens(),
      colors: { ...getDefaultAppearanceTokens().colors, textColor: "#f0f0f0", surfaceColor: "#ffffff" },
    };
    const warnings = checkAppearanceContrast(tokens);
    expect(warnings.some((w) => w.pair === "text-on-surface")).toBe(true);
  });

  it("never warns about textColor when it is null (inherit currentColor — nothing to check)", () => {
    const tokens = { ...getDefaultAppearanceTokens(), colors: { ...getDefaultAppearanceTokens().colors, textColor: null } };
    const warnings = checkAppearanceContrast(tokens);
    expect(warnings.some((w) => w.pair === "text-on-surface")).toBe(false);
  });

  it("warns when the star color is effectively invisible against the surface color", () => {
    const tokens = {
      ...getDefaultAppearanceTokens(),
      colors: { ...getDefaultAppearanceTokens().colors, starColor: "#fefefe", surfaceColor: "#ffffff" },
    };
    const warnings = checkAppearanceContrast(tokens);
    expect(warnings.some((w) => w.pair === "star-on-surface")).toBe(true);
  });

  // The regression this whole check exists for: a live store was handed #B0B0B0 by the AI
  // brand suggestion and shipped it, making every rating unreadable.
  it("warns when the star color is a grey that cannot be told apart from an unfilled star", () => {
    const tokens = {
      ...getDefaultAppearanceTokens(),
      colors: { ...getDefaultAppearanceTokens().colors, starColor: "#B0B0B0", surfaceColor: "#ffffff" },
    };
    const warnings = checkAppearanceContrast(tokens);
    expect(warnings.some((w) => w.pair === "star-vs-empty")).toBe(true);
  });

  it("accepts a dark neutral star — achromatic, but plainly distinct from an unfilled star", () => {
    const tokens = {
      ...getDefaultAppearanceTokens(),
      colors: { ...getDefaultAppearanceTokens().colors, starColor: "#2B2B2B", surfaceColor: "#ffffff" },
    };
    expect(checkStarLegibility("#2B2B2B", "#ffffff", tokens.colors.starEmptyColor)).toBeNull();
  });

  it("accepts the conventional amber star, which luminance contrast alone would reject", () => {
    expect(checkStarLegibility("#f5a623", "#ffffff", "rgba(0, 0, 0, 0.15)")).toBeNull();
  });

  it("judges the star against the unfilled star as actually rendered, blending it onto the surface", () => {
    // On a dark card the same translucent-black unfilled star composites to near-black, so a
    // grey filled star becomes readable there — the opposite verdict to the white card above,
    // and only reachable by flattening the overlay rather than trying to parse it as a hex.
    expect(flattenOntoSurface("rgba(0, 0, 0, 0.15)", "#ffffff")).toBe("#d9d9d9");
    expect(flattenOntoSurface("rgba(0, 0, 0, 0.15)", "#0e0e10")).toBe("#0c0c0e");
    expect(checkStarLegibility("#B0B0B0", "#0e0e10", "rgba(0, 0, 0, 0.15)")).toBeNull();
  });

  it("does not fabricate a verdict for an unparseable star or unfilled-star value", () => {
    expect(checkStarLegibility("not-a-color", "#ffffff", "rgba(0, 0, 0, 0.15)")).toBeNull();
    expect(checkStarLegibility("#B0B0B0", "#ffffff", "var(--something)")).toBeNull();
  });

  it("has no warnings for a genuinely high-contrast configuration", () => {
    const tokens = {
      ...getDefaultAppearanceTokens(),
      colors: { ...getDefaultAppearanceTokens().colors, textColor: "#000000", starColor: "#000000", surfaceColor: "#ffffff" },
    };
    expect(checkAppearanceContrast(tokens)).toEqual([]);
  });
});
