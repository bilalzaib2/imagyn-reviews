import { describe, expect, it, vi } from "vitest";

const generateBrandSuggestion = vi.fn(async () => ({
  starColor: "#2B2B2B",
  typography: { scale: 1.05, letterSpacing: "tight" as const },
  rationale: "A restrained neutral.",
  modelUsed: "fake-model",
}));

vi.mock("./ai/provider.server", () => ({
  getAiProvider: () => ({
    name: "fake-provider",
    generateReviewSummary: vi.fn(),
    generateBrandSuggestion,
  }),
}));

const { generateAiBrandSuggestion } = await import("./brandSuggestion.server");

describe("generateAiBrandSuggestion", () => {
  it("passes shop name and detected color through to the provider", async () => {
    await generateAiBrandSuggestion({ shopName: "Verve Studio", detectedColor: "#123456" });
    expect(generateBrandSuggestion).toHaveBeenCalledWith({
      shopName: "Verve Studio",
      detectedColor: "#123456",
    });
  });

  it("passes a null detectedColor through unchanged when Brand Match found nothing", async () => {
    await generateAiBrandSuggestion({ shopName: "Verve Studio", detectedColor: null });
    expect(generateBrandSuggestion).toHaveBeenCalledWith({
      shopName: "Verve Studio",
      detectedColor: null,
    });
  });

  it("returns the provider's result with the provider name attached", async () => {
    const result = await generateAiBrandSuggestion({ shopName: "Verve Studio", detectedColor: null });
    expect(result).toEqual({
      starColor: "#2B2B2B",
      typography: { scale: 1.05, letterSpacing: "tight" },
      rationale: "A restrained neutral.",
      modelUsed: "fake-model",
      provider: "fake-provider",
    });
  });
});
