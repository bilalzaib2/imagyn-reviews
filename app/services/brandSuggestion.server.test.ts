import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeSuggestion {
  starColor: string;
  typography: { scale: number; letterSpacing: "tight" | "normal" };
  rationale: string;
  modelUsed: string;
}

let suggestion: FakeSuggestion;

const generateBrandSuggestion = vi.fn(async () => suggestion);

let palette: { accent: string | null; background: string | null; candidates: string[] } | null = null;
const getStorePaletteMock = vi.fn(async () => palette);
vi.mock("./storePalette.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storePalette.server")>();
  return {
    ...actual,
    // Never reach the network in a unit test; isDarkBackground stays real so the dark-store
    // signal is exercised rather than stubbed.
    getStorePalette: () => getStorePaletteMock(),
  };
});

vi.mock("./ai/provider.server", () => ({
  getAiProvider: () => ({
    name: "fake-provider",
    generateReviewSummary: vi.fn(),
    generateBrandSuggestion,
  }),
}));

const { generateAiBrandSuggestion } = await import("./brandSuggestion.server");

beforeEach(() => {
  generateBrandSuggestion.mockClear();
  getStorePaletteMock.mockClear();
  palette = null;
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
    expect(generateBrandSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ shopName: "Verve Studio", detectedColor: "#123456" }),
    );
  });

  it("passes a null detectedColor through unchanged when Brand Match found nothing", async () => {
    await generateAiBrandSuggestion({ shopName: "Verve Studio", detectedColor: null });
    expect(generateBrandSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ shopName: "Verve Studio", detectedColor: null }),
    );
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

// The whole point of the feature: a suggestion should be informed by what the merchant's
// store actually looks like, not by their shop name alone.
describe("store context", () => {
  it("reads the live storefront palette and passes it to the model", async () => {
    palette = { accent: "#2453d3", background: "#f6f6f8", candidates: ["#2453d3"] };
    await generateAiBrandSuggestion({
      shopName: "Grace Store",
      detectedColor: null,
      shopDomain: "gracestoreofficial.myshopify.com",
    });

    expect(generateBrandSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ storeAccent: "#2453d3", storeBackground: "#f6f6f8", storeIsDark: false }),
    );
  });

  it("tells the model when the store is dark, so the accent can stay bright", async () => {
    palette = { accent: "#f5b544", background: "#101014", candidates: ["#f5b544"] };
    await generateAiBrandSuggestion({ shopName: "Dark Co", detectedColor: null, shopDomain: "dark.myshopify.com" });

    expect(generateBrandSuggestion).toHaveBeenCalledWith(expect.objectContaining({ storeIsDark: true }));
  });

  it("does not invent a palette when the storefront could not be read", async () => {
    palette = null;
    await generateAiBrandSuggestion({ shopName: "Quiet Co", detectedColor: null, shopDomain: "quiet.myshopify.com" });

    expect(generateBrandSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ storeAccent: null, storeBackground: null, storeIsDark: false }),
    );
  });

  it("skips the storefront read entirely when no domain is known", async () => {
    await generateAiBrandSuggestion({ shopName: "No Domain", detectedColor: null });

    expect(getStorePaletteMock).not.toHaveBeenCalled();
  });

  it("still returns a suggestion when the storefront read fails", async () => {
    palette = null;
    const result = await generateAiBrandSuggestion({
      shopName: "Quiet Co",
      detectedColor: null,
      shopDomain: "quiet.myshopify.com",
    });

    expect(result.starColor).toBe("#2B2B2B");
    expect(result.provider).toBe("fake-provider");
  });
});
