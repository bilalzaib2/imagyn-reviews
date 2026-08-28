import { describe, expect, it } from "vitest";
import { parseBrandSuggestionJson } from "./shared";
import { AiProviderError } from "./types";

describe("parseBrandSuggestionJson", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({
      starColor: "#2B2B2B",
      scale: 1.05,
      letterSpacing: "tight",
      rationale: "A restrained neutral that pairs well with a minimal storefront.",
    });

    expect(parseBrandSuggestionJson(raw, "test")).toEqual({
      starColor: "#2B2B2B",
      typography: { scale: 1.05, letterSpacing: "tight" },
      rationale: "A restrained neutral that pairs well with a minimal storefront.",
    });
  });

  it("extracts JSON wrapped in markdown fences", () => {
    const raw = '```json\n{"starColor":"#111111","scale":1,"letterSpacing":"normal","rationale":"x"}\n```';
    expect(parseBrandSuggestionJson(raw, "test").starColor).toBe("#111111");
  });

  it("defaults a missing rationale to an empty string rather than failing", () => {
    const raw = JSON.stringify({ starColor: "#111111", scale: 1, letterSpacing: "normal" });
    expect(parseBrandSuggestionJson(raw, "test").rationale).toBe("");
  });

  it("clamps an out-of-range scale instead of rejecting it", () => {
    const tooSmall = JSON.stringify({ starColor: "#111111", scale: 0.5, letterSpacing: "normal" });
    expect(parseBrandSuggestionJson(tooSmall, "test").typography.scale).toBe(0.9);

    const tooLarge = JSON.stringify({ starColor: "#111111", scale: 2, letterSpacing: "normal" });
    expect(parseBrandSuggestionJson(tooLarge, "test").typography.scale).toBe(1.15);
  });

  it("rejects an invalid hex color rather than inventing one", () => {
    const raw = JSON.stringify({ starColor: "not-a-color", scale: 1, letterSpacing: "normal" });
    expect(() => parseBrandSuggestionJson(raw, "test")).toThrow(AiProviderError);
  });

  it("rejects a letterSpacing value outside the two allowed options", () => {
    const raw = JSON.stringify({ starColor: "#111111", scale: 1, letterSpacing: "loose" });
    expect(() => parseBrandSuggestionJson(raw, "test")).toThrow(AiProviderError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseBrandSuggestionJson("not json at all", "test")).toThrow(AiProviderError);
  });

  it("rejects a non-object JSON value", () => {
    expect(() => parseBrandSuggestionJson("42", "test")).toThrow(AiProviderError);
  });
});
