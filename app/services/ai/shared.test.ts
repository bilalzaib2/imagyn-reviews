import { describe, expect, it } from "vitest";
import { buildReplyDraftUserPrompt, parseBrandSuggestionJson, parseReplyDraftJson } from "./shared";
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

describe("parseReplyDraftJson", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({ draft: "Thanks so much for the detailed feedback!" });
    expect(parseReplyDraftJson(raw, "test")).toEqual({ draft: "Thanks so much for the detailed feedback!" });
  });

  it("extracts JSON wrapped in markdown fences", () => {
    const raw = '```json\n{"draft":"Appreciate you sharing this."}\n```';
    expect(parseReplyDraftJson(raw, "test").draft).toBe("Appreciate you sharing this.");
  });

  it("rejects a missing draft rather than inventing one", () => {
    expect(() => parseReplyDraftJson(JSON.stringify({}), "test")).toThrow(AiProviderError);
  });

  it("rejects an empty-string draft the same as a missing one", () => {
    expect(() => parseReplyDraftJson(JSON.stringify({ draft: "   " }), "test")).toThrow(AiProviderError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseReplyDraftJson("not json at all", "test")).toThrow(AiProviderError);
  });
});

describe("buildReplyDraftUserPrompt", () => {
  it("includes the review title when present", () => {
    const prompt = buildReplyDraftUserPrompt({
      productName: "Grace Star Dress",
      review: { rating: 5, title: "Great fit", content: "Loved it." },
      existingDraft: null,
    });
    expect(prompt).toContain('"Great fit"');
    expect(prompt).toContain("Loved it.");
  });

  it("omits any title mention when the review has none", () => {
    const prompt = buildReplyDraftUserPrompt({
      productName: "Grace Star Dress",
      review: { rating: 3, title: null, content: "It was fine." },
      existingDraft: null,
    });
    expect(prompt).not.toContain('""');
    expect(prompt).toContain("It was fine.");
  });

  it("includes the merchant's own in-progress draft as revision context when given", () => {
    const prompt = buildReplyDraftUserPrompt({
      productName: "Grace Star Dress",
      review: { rating: 4, title: null, content: "Good but slow shipping." },
      existingDraft: "Sorry about that!",
    });
    expect(prompt).toContain("already started a draft reply");
    expect(prompt).toContain("Sorry about that!");
  });
});
