import { describe, expect, it } from "vitest";
import { getDefaultAppearanceTokens, mergeAppearanceTokens } from "./appearance.shared";

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
