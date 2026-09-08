// Exercises moderationRules.server.ts's real hold/auto-approve decision logic — the single
// gate every real customer review submission passes through before createReview() persists
// it. No prisma/email mocking needed for the bulk of this: parseBannedWords, containsLink,
// containsProfanity, findBannedWord, and evaluateReview are all pure functions.
import { describe, expect, it } from "vitest";
import {
  containsLink,
  containsProfanity,
  evaluateReview,
  findBannedWord,
  parseBannedWords,
  type ModerationSettings,
} from "./moderationRules.server";

function settings(overrides: Partial<ModerationSettings> = {}): ModerationSettings {
  return {
    enabled: true,
    minRating: 4,
    requireVerified: false,
    holdLinks: true,
    holdProfanity: true,
    bannedWords: [],
    notifyOnHold: false,
    notifyEmail: null,
    ...overrides,
  };
}

describe("parseBannedWords", () => {
  it("splits on newlines, trims, and drops blank lines", () => {
    expect(parseBannedWords("scam\n  spam  \n\nfake\r\ncounterfeit")).toEqual(["scam", "spam", "fake", "counterfeit"]);
  });

  it("returns an empty array for an empty or whitespace-only textarea", () => {
    expect(parseBannedWords("")).toEqual([]);
    expect(parseBannedWords("   \n  \n")).toEqual([]);
  });
});

describe("containsLink", () => {
  it("detects http(s) URLs and www. prefixes", () => {
    expect(containsLink("check out https://example.com for a discount")).toBe(true);
    expect(containsLink("visit www.example.com")).toBe(true);
  });

  it("does not flag plain text that merely mentions a dotted domain-like word", () => {
    expect(containsLink("I bought this from acme.com last year and love it")).toBe(false);
  });
});

describe("containsProfanity", () => {
  it("flags genuinely profane text", () => {
    expect(containsProfanity("this product is fucking terrible")).toBe(true);
  });

  it("does not flag clean text", () => {
    expect(containsProfanity("this product is genuinely terrible")).toBe(false);
  });
});

describe("findBannedWord", () => {
  it("matches a banned word as a whole word, case-insensitively", () => {
    expect(findBannedWord("This is a SCAM product", ["scam"])).toBe("scam");
  });

  it("does not match a banned word as a substring of a different word", () => {
    expect(findBannedWord("I scammed nobody, this is scampering good", ["scam"])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findBannedWord("Great product, would buy again", ["scam", "fraud"])).toBeNull();
  });
});

describe("evaluateReview", () => {
  it("does nothing when moderation rules are disabled — never blocks or approves", () => {
    const decision = evaluateReview(settings({ enabled: false }), {
      rating: 5,
      content: "Contains a link https://spam.com and profanity fuck",
      verifiedPurchase: true,
    });
    expect(decision).toEqual({ autoApprove: false, moderationStatus: null, moderationReason: null });
  });

  it("holds a review containing a link even if it would otherwise auto-approve", () => {
    const decision = evaluateReview(settings(), {
      rating: 5,
      content: "Great product, check my results at https://example.com",
      verifiedPurchase: true,
    });
    expect(decision.autoApprove).toBe(false);
    expect(decision.moderationStatus).toBe("held");
    expect(decision.moderationReason).toMatch(/link/);
  });

  it("holds a review containing profanity even at a 5-star rating", () => {
    const decision = evaluateReview(settings({ holdLinks: false }), {
      rating: 5,
      content: "This is a fucking amazing product",
      verifiedPurchase: true,
    });
    expect(decision.moderationStatus).toBe("held");
    expect(decision.moderationReason).toMatch(/profanity/);
  });

  it("holds a review containing a store-specific banned word, quoting it in the reason", () => {
    const decision = evaluateReview(settings({ holdLinks: false, holdProfanity: false, bannedWords: ["knockoff"] }), {
      rating: 5,
      content: "This is basically a knockoff of the real thing",
      verifiedPurchase: true,
    });
    expect(decision.moderationStatus).toBe("held");
    expect(decision.moderationReason).toContain('"knockoff"');
  });

  it("checks the title for hold triggers, not just the body", () => {
    const decision = evaluateReview(settings({ holdProfanity: false, holdLinks: false, bannedWords: ["scam"] }), {
      rating: 5,
      title: "Total scam",
      content: "Would not recommend",
      verifiedPurchase: true,
    });
    expect(decision.moderationStatus).toBe("held");
  });

  it("auto-approves a review meeting the minimum rating when verification isn't required", () => {
    const decision = evaluateReview(settings({ minRating: 4, requireVerified: false }), {
      rating: 4,
      content: "Pretty good, no complaints",
      verifiedPurchase: false,
    });
    expect(decision).toEqual({
      autoApprove: true,
      moderationStatus: "auto_approved",
      moderationReason: "Auto-approved: 4★ meets the 4★ minimum",
    });
  });

  it("does not auto-approve a review below the minimum rating", () => {
    const decision = evaluateReview(settings({ minRating: 4 }), {
      rating: 3,
      content: "It was okay",
      verifiedPurchase: true,
    });
    expect(decision).toEqual({ autoApprove: false, moderationStatus: null, moderationReason: null });
  });

  it("requires verified purchase when requireVerified is on, even at a qualifying rating", () => {
    const decision = evaluateReview(settings({ minRating: 4, requireVerified: true }), {
      rating: 5,
      content: "Loved it",
      verifiedPurchase: false,
    });
    expect(decision).toEqual({ autoApprove: false, moderationStatus: null, moderationReason: null });
  });

  it("auto-approves and mentions verification in the reason when both rating and verification are satisfied", () => {
    const decision = evaluateReview(settings({ minRating: 4, requireVerified: true }), {
      rating: 5,
      content: "Loved it, fast shipping",
      verifiedPurchase: true,
    });
    expect(decision.autoApprove).toBe(true);
    expect(decision.moderationReason).toMatch(/verified buyer/);
  });
});
