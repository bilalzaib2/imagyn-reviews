// Headline suggestion from a review body (Judge.me parity, audit §4.2).
//
// The whole value of this feature is that a merchant's review widget gets a scannable one-line
// summary instead of a blank headline, which is what most customers leave. The whole RISK is
// that a bad guess ships as a customer's own words on a public product page — so most of these
// tests are about when it correctly declines to guess.
import { describe, expect, it } from "vitest";

import { suggestReviewTitle, SUGGESTED_TITLE_MAX_LENGTH } from "./review.shared";

describe("suggesting a headline", () => {
  it("takes the first sentence", () => {
    expect(suggestReviewTitle("The linen is heavier than I expected. In a good way. True to size.")).toBe(
      "The linen is heavier than I expected",
    );
  });

  // A headline is a label, not a sentence.
  it.each([
    ["Exactly what I hoped for.", "Exactly what I hoped for"],
    ["Absolutely love this jacket!", "Absolutely love this jacket"],
    ["Is it worth the money? Yes, easily.", "Is it worth the money"],
    ["So good!!! Would buy again.", "So good"],
  ])("drops terminal punctuation: %j", (body, expected) => {
    expect(suggestReviewTitle(body)).toBe(expected);
  });

  it("uses the whole body when there is no sentence break", () => {
    expect(suggestReviewTitle("Heavier linen than expected and the fit is spot on")).toBe(
      "Heavier linen than expected and the fit is spot on",
    );
  });

  it("collapses the whitespace a textarea produces", () => {
    expect(suggestReviewTitle("Lovely   fabric\n\nand a great   fit overall. Ordered another.")).toBe(
      "Lovely fabric and a great fit overall",
    );
  });

  // A decimal or an abbreviation is not a sentence break.
  // Two distinct protections, for two distinct failures — see the implementation's own note.
  // The decimal is caught by requiring whitespace after the full stop; the abbreviation is
  // caught only by requiring a capital letter after it.
  it("is not fooled by a full stop inside a number or abbreviation", () => {
    expect(suggestReviewTitle("Arrived in 2.5 days which is quicker than promised. Very pleased.")).toBe(
      "Arrived in 2.5 days which is quicker than promised",
    );
    expect(suggestReviewTitle("Runs small, i.e. order a size up from your usual. Otherwise lovely.")).toBe(
      "Runs small, i.e. order a size up from your usual",
    );
  });
});

describe("declining to suggest — a blank headline beats a bad one", () => {
  // Under ~25 characters the body IS the summary, and repeating it would print the same
  // sentence twice in the widget.
  it.each(["", "   ", "Great", "Love it", "Perfect fit, thanks!", "Really nice quality"])(
    "returns null for %j",
    (body) => {
      expect(suggestReviewTitle(body)).toBeNull();
    },
  );

  // A degenerate first sentence, from a body long enough to be worth summarising.
  it.each([
    "Yes. The fit is true to the size guide and the fabric is lovely.",
    "No. It arrived damaged and the returns process took three weeks.",
    "Ok. Not what I expected from the photos but it does the job fine.",
  ])("returns null when the first sentence is only a fragment: %j", (body) => {
    expect(suggestReviewTitle(body)).toBeNull();
  });

  // ...but a genuinely short headline is not a fragment, and must survive.
  it.each([
    ["So good!!! Would buy again and again honestly.", "So good"],
    ["Lovely. The linen is heavier than I expected, in a good way.", "Lovely"],
  ])("keeps a real short headline: %j", (body, expected) => {
    expect(suggestReviewTitle(body)).toBe(expected);
  });

  // The case that would produce a headline ending mid-word.
  it("returns null rather than truncating a long first sentence with no clean break", () => {
    const unbroken = "A".repeat(200);
    expect(suggestReviewTitle(`${unbroken}. And then some more.`)).toBeNull();
  });

  it("cuts at a word boundary when the first sentence is long but breakable", () => {
    const body = `${"word ".repeat(40).trim()}. Second sentence.`;
    const suggested = suggestReviewTitle(body);

    expect(suggested).not.toBeNull();
    expect(suggested!.length).toBeLessThanOrEqual(SUGGESTED_TITLE_MAX_LENGTH);
    // No partial word at either end.
    expect(suggested).toMatch(/^word( word)*$/);
  });
});

describe("the suggestion always fits the field", () => {
  it("never exceeds the headline input's maxLength", () => {
    const bodies = [
      "The linen is heavier than I expected, in a good way, and the fit is true to the size guide so I did not need to exchange anything at all. Lovely.",
      `${"a longer phrase ".repeat(20)}. Next.`,
      "Short one. Then a very much longer second sentence that should never be reached by this function at all.",
    ];

    for (const body of bodies) {
      const suggested = suggestReviewTitle(body);
      if (suggested !== null) {
        expect(suggested.length).toBeLessThanOrEqual(SUGGESTED_TITLE_MAX_LENGTH);
      }
    }
  });

  it("is pure — the same body always gives the same suggestion", () => {
    const body = "Ordered on Thursday and it arrived Saturday. Very pleased with the whole thing.";
    expect(suggestReviewTitle(body)).toBe(suggestReviewTitle(body));
  });
});
