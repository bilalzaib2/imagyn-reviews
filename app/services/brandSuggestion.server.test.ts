import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSuggestion {
  starColor: string;
  typography: { scale: number; letterSpacing: "tight" | "normal" };
  rationale: string;
  modelUsed: string;
}

let suggestion: FakeSuggestion;

const generateBrandSuggestion = vi.fn(async () => suggestion);

vi.mock("./ai/provider.server", () => ({
  getAiProvider: () => ({
    name: "fake-provider",
    generateReviewSummary: vi.fn(),
    generateBrandSuggestion,
  }),
}));

const { generateAiBrandSuggestion } = await import("./brandSuggestion.server");

beforeEach(() => {
  suggestion = {
    starColor: "#2B2B2B",
    typography: { scale: 1.05, letterSpacing: "tight" },
    rationale: "A restrained neutral.",
    modelUsed: "fake-model",
  };
});

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

// A suggestion is one click from the merchant's live storefront, so an unreadable accent has
// to be caught here and not merely discouraged in the prompt.
describe("star color legibility guard", () => {
  it("replaces a grey star that cannot be told apart from an unfilled star", async () => {
    // The exact color a live store was handed, and shipped.
    suggestion = { ...suggestion, starColor: "#B0B0B0" };
    const result = await generateAiBrandSuggestion({ shopName: "Grace Store", detectedColor: null });

    expect(result.starColor).toBe("#f5a623");
  });

  it("replaces a star color that would be invisible on a white review card", async () => {
    suggestion = { ...suggestion, starColor: "#fefefe" };
    const result = await generateAiBrandSuggestion({ shopName: "Grace Store", detectedColor: null });

    expect(result.starColor).toBe("#f5a623");
  });

  it("tells the merchant it substituted, naming the color it rejected", async () => {
    suggestion = { ...suggestion, starColor: "#B0B0B0" };
    const result = await generateAiBrandSuggestion({ shopName: "Grace Store", detectedColor: null });

    expect(result.rationale).toContain("A restrained neutral.");
    expect(result.rationale).toContain("#B0B0B0");
  });

  it("keeps the rest of the suggestion rather than discarding it", async () => {
    suggestion = { ...suggestion, starColor: "#B0B0B0", typography: { scale: 1.1, letterSpacing: "normal" } };
    const result = await generateAiBrandSuggestion({ shopName: "Grace Store", detectedColor: null });

    expect(result.typography).toEqual({ scale: 1.1, letterSpacing: "normal" });
    expect(result.provider).toBe("fake-provider");
    expect(result.modelUsed).toBe("fake-model");
  });

  it("leaves a readable accent and its rationale completely untouched", async () => {
    suggestion = { ...suggestion, starColor: "#E8A33D" };
    const result = await generateAiBrandSuggestion({ shopName: "Grace Store", detectedColor: null });

    expect(result.starColor).toBe("#E8A33D");
    expect(result.rationale).toBe("A restrained neutral.");
  });

  it("leaves a dark neutral accent alone — achromatic, but plainly distinct from an unfilled star", async () => {
    const result = await generateAiBrandSuggestion({ shopName: "Grace Store", detectedColor: null });

    expect(result.starColor).toBe("#2B2B2B");
    expect(result.rationale).toBe("A restrained neutral.");
  });
});
