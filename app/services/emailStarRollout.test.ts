// One-tap star rating — the rollout contract.
//
// This file exists for one approved requirement: the star row is ON for newly installed
// stores and must NOT change the outgoing email of a store that already saved a template.
// Those two sentences pull in opposite directions inside a single JSON contract, so the rule
// is worth pinning from every direction a real store can arrive from.
//
// The mechanism being tested:
//
//   - A store with NO saved row renders getDefaultEmailTemplateContent, which does not route
//     through normalizeEmailSections at all. Stars on.
//   - A store WITH a saved row goes through mergeEmailTemplateContent. Any section in
//     SECTIONS_ADDED_AFTER_LAUNCH that the saved row does not name is back-filled OFF.
//
// Nothing here mocks anything. These are the real functions the send path and the Email
// Studio loader both use.
import { describe, expect, it } from "vitest";

import {
  buildRatingUrl,
  buildRatingUrls,
  getDefaultEmailTemplateContent,
  mergeEmailTemplateContent,
  normalizeEmailSections,
  parseRatingParam,
  EMAIL_STAR_RATINGS,
  EMAIL_TEMPLATE_TYPES,
  SECTIONS_ADDED_AFTER_LAUNCH,
  type EmailSection,
  type EmailTemplateContent,
  type EmailTemplateType,
} from "./email.shared";

/** Every section the contract shipped with BEFORE the star row existed, in canonical order —
 *  i.e. exactly what a template saved by an existing merchant looks like. */
const PRE_STARS_SECTIONS: EmailSection[] = [
  { id: "logo", enabled: true },
  { id: "storeName", enabled: true },
  { id: "heading", enabled: true },
  { id: "body", enabled: true },
  { id: "product", enabled: true },
  { id: "button", enabled: true },
  { id: "closing", enabled: true },
];

function starsIn(content: EmailTemplateContent): EmailSection | undefined {
  return content.sections.find((section) => section.id === "stars");
}

function starsEnabled(content: EmailTemplateContent): boolean {
  return starsIn(content)?.enabled === true;
}

/** The template types that render a star row at all. "reward" never does — its CTA is the
 *  merchant's storefront, not a review form. */
const REVIEW_TYPES: readonly EmailTemplateType[] = ["review_request", "reminder_1", "reminder_final"];

describe("the rollout record", () => {
  it("lists the star row, and only the star row", () => {
    expect(SECTIONS_ADDED_AFTER_LAUNCH).toEqual(["stars"]);
  });
});

describe("a NEWLY INSTALLED store — no saved template", () => {
  // A store that has never opened Email Studio has no EmailTemplate row, so
  // emailTemplateService.getActiveContent returns these defaults verbatim.
  it.each(REVIEW_TYPES)("gets the star row switched on for %s", (type) => {
    expect(starsEnabled(getDefaultEmailTemplateContent(type))).toBe(true);
  });

  it("does not get it on the reward template, which has no review form to send them to", () => {
    expect(starsIn(getDefaultEmailTemplateContent("reward"))).toEqual({ id: "stars", enabled: false });
  });

  it("places it immediately before the review button", () => {
    const ids = getDefaultEmailTemplateContent().sections.map((section) => section.id);
    expect(ids[ids.indexOf("stars") + 1]).toBe("button");
  });

  // An empty partial is not a saved row — it is no row at all. This is the path a brand-new
  // store takes if anything ever merges an empty object over the defaults, and it must land on
  // the same answer as the defaults themselves.
  it.each(EMAIL_TEMPLATE_TYPES)("reaches the same answer through an empty merge for %s", (type) => {
    expect(mergeEmailTemplateContent({}, type)).toEqual(getDefaultEmailTemplateContent(type));
  });
});

describe("an EXISTING store — a template saved before the star row existed", () => {
  // THE requirement. A merchant who reviewed, approved and watched their email go out must
  // not find a new block in it because the app shipped one.
  it.each(REVIEW_TYPES)("keeps the star row OFF for %s", (type) => {
    const saved = mergeEmailTemplateContent(
      { subject: "Their own subject", sections: PRE_STARS_SECTIONS },
      type,
    );

    expect(starsIn(saved)).toEqual({ id: "stars", enabled: false });
  });

  it("changes nothing else about their email", () => {
    const saved = mergeEmailTemplateContent(
      {
        subject: "Sarah, how's the linen jacket?",
        heading: "We'd love your thoughts",
        buttonText: "Leave a review",
        accentColor: "#c026d3",
        sections: PRE_STARS_SECTIONS,
      },
      "review_request",
    );

    expect(saved.subject).toBe("Sarah, how's the linen jacket?");
    expect(saved.heading).toBe("We'd love your thoughts");
    expect(saved.buttonText).toBe("Leave a review");
    expect(saved.accentColor).toBe("#c026d3");
    // Their seven blocks, in their order, with their enabled flags — plus the new one, off.
    expect(saved.sections.filter((section) => section.id !== "stars")).toEqual(PRE_STARS_SECTIONS);
  });

  it("keeps their own disabled sections disabled", () => {
    const saved = mergeEmailTemplateContent(
      {
        sections: PRE_STARS_SECTIONS.map((section) =>
          section.id === "logo" || section.id === "closing" ? { ...section, enabled: false } : section,
        ),
      },
      "review_request",
    );

    expect(saved.sections.find((section) => section.id === "logo")?.enabled).toBe(false);
    expect(saved.sections.find((section) => section.id === "closing")?.enabled).toBe(false);
    expect(starsEnabled(saved)).toBe(false);
  });

  it("respects their own reordering", () => {
    const reordered = [...PRE_STARS_SECTIONS].reverse();
    const saved = mergeEmailTemplateContent({ sections: reordered }, "review_request");

    expect(saved.sections.filter((section) => section.id !== "stars").map((section) => section.id)).toEqual(
      reordered.map((section) => section.id),
    );
  });

  // The older legacy shape: a row saved before `sections` was a field at all. It has no list
  // to inspect, so mergeEmailTemplateContent substitutes the pre-star list to make it look
  // like what it is.
  it.each(REVIEW_TYPES)("keeps it OFF for a row that predates the sections field entirely (%s)", (type) => {
    const saved = mergeEmailTemplateContent({ subject: "Saved long ago" }, type);

    expect(starsIn(saved)).toEqual({ id: "stars", enabled: false });
    // ...and every section they did have is still there, in order.
    expect(saved.sections.filter((section) => section.id !== "stars").map((section) => section.id)).toEqual(
      PRE_STARS_SECTIONS.map((section) => section.id),
    );
  });

  // Found by a test, and worth keeping: back-filling by appending put the star row AFTER the
  // closing sign-off for every existing merchant. Invisible while it is off, and visibly wrong
  // the moment one of them switches it on — which is the exact case this back-fill serves.
  it("back-fills it above the review button, not after the sign-off", () => {
    const saved = mergeEmailTemplateContent({ sections: PRE_STARS_SECTIONS }, "review_request");
    const ids = saved.sections.map((section) => section.id);

    expect(ids[ids.indexOf("stars") + 1]).toBe("button");
    expect(ids.indexOf("stars")).toBeLessThan(ids.indexOf("closing"));
  });

  it("back-fills it above the button even when they moved the button", () => {
    // Their own order, with the CTA pulled up above the product block.
    const reordered: EmailSection[] = [
      { id: "logo", enabled: true },
      { id: "heading", enabled: true },
      { id: "button", enabled: true },
      { id: "body", enabled: true },
      { id: "product", enabled: true },
      { id: "storeName", enabled: true },
      { id: "closing", enabled: true },
    ];

    const ids = mergeEmailTemplateContent({ sections: reordered }, "review_request").sections.map(
      (section) => section.id,
    );

    expect(ids[ids.indexOf("stars") + 1]).toBe("button");
  });

  it("appends it at the end only when no later section survives to anchor it", () => {
    // A list with nothing that follows the star row canonically (button and closing both
    // absent) — the button is then force-added by the required-section rule, so this asserts
    // the fallback path does not crash or duplicate.
    const repaired = normalizeEmailSections([
      { id: "logo", enabled: true },
      { id: "heading", enabled: true },
    ]);

    expect(repaired.filter((section) => section.id === "stars")).toHaveLength(1);
    expect(repaired.find((section) => section.id === "stars")?.enabled).toBe(false);
  });

  it("is stable — reading the same row twice does not drift", () => {
    const once = mergeEmailTemplateContent({ sections: PRE_STARS_SECTIONS }, "review_request");
    const twice = mergeEmailTemplateContent(once, "review_request");

    expect(twice.sections).toEqual(once.sections);
    expect(starsEnabled(twice)).toBe(false);
  });
});

describe("an EXISTING store that then turns the star row on", () => {
  // The merchant's own choice must survive every subsequent read — this is the opposite
  // failure to the one above, and just as bad.
  it("keeps it on once they have saved it on", () => {
    const theirChoice = [...PRE_STARS_SECTIONS, { id: "stars" as const, enabled: true }];
    const saved = mergeEmailTemplateContent({ sections: theirChoice }, "review_request");

    expect(starsEnabled(saved)).toBe(true);
  });

  it("keeps it where they put it, not in canonical position", () => {
    const theirChoice: EmailSection[] = [
      { id: "stars", enabled: true },
      ...PRE_STARS_SECTIONS,
    ];
    const saved = mergeEmailTemplateContent({ sections: theirChoice }, "review_request");

    expect(saved.sections[0]).toEqual({ id: "stars", enabled: true });
  });

  it("lets them turn it back off again", () => {
    const off = [...PRE_STARS_SECTIONS, { id: "stars" as const, enabled: false }];
    expect(starsEnabled(mergeEmailTemplateContent({ sections: off }, "review_request"))).toBe(false);
  });
});

describe("normalizeEmailSections — the back-fill rule in isolation", () => {
  it("appends the star row OFF when the list named other sections but not it", () => {
    const repaired = normalizeEmailSections(PRE_STARS_SECTIONS);
    expect(repaired.find((section) => section.id === "stars")).toEqual({ id: "stars", enabled: false });
  });

  // An empty or junk input is not a saved row predating the section — it is no row at all, so
  // it gets the full shipped defaults, exactly as a new install does.
  it.each([[], null, undefined, "nonsense", 42, {}, [null, 7, "x"], [{ id: "notASection" }]])(
    "gives the full shipped defaults for %j",
    (input) => {
      const repaired = normalizeEmailSections(input);
      expect(repaired.find((section) => section.id === "stars")).toEqual({ id: "stars", enabled: true });
      expect(repaired).toEqual(getDefaultEmailTemplateContent().sections);
    },
  );

  it("still back-fills every OTHER missing section at its canonical default", () => {
    // A saved list with only the required button: product, heading and the rest come back on,
    // because they are not late additions — only the star row is.
    const repaired = normalizeEmailSections([{ id: "button", enabled: true }]);

    expect(repaired.find((section) => section.id === "heading")?.enabled).toBe(true);
    expect(repaired.find((section) => section.id === "product")?.enabled).toBe(true);
    expect(repaired.find((section) => section.id === "stars")?.enabled).toBe(false);
  });

  it("never lets the review button be disabled, whatever the input claims", () => {
    const repaired = normalizeEmailSections([{ id: "button", enabled: false }]);
    expect(repaired.find((section) => section.id === "button")?.enabled).toBe(true);
  });
});

describe("all five ratings route to the correct submission flow", () => {
  it("offers exactly five, lowest first", () => {
    expect(EMAIL_STAR_RATINGS).toEqual([1, 2, 3, 4, 5]);
  });

  it.each(EMAIL_STAR_RATINGS)("rating %i carries itself to the identical form", (rating) => {
    const reviewUrl = "https://app.imagyn.co/r/tok_abc123";
    const url = buildRatingUrl(reviewUrl, rating);

    // Same origin, same path, same token — only the pre-selection differs.
    expect(url.split("?")[0]).toBe(reviewUrl);
    // ...and the landing page reads back the rating that was tapped, not a neighbouring one.
    expect(parseRatingParam(new URL(url).searchParams.get("r"))).toBe(rating);
  });

  it("produces five distinct links to one destination", () => {
    const urls = buildRatingUrls("https://app.imagyn.co/r/tok_abc123");

    expect(new Set(urls).size).toBe(5);
    expect(new Set(urls.map((url) => url.split("?")[0])).size).toBe(1);
  });

  it("round-trips every rating through the real query parameter", () => {
    const parsed = buildRatingUrls("https://app.imagyn.co/r/tok_abc123").map((url) =>
      parseRatingParam(new URL(url).searchParams.get("r")),
    );

    expect(parsed).toEqual([1, 2, 3, 4, 5]);
  });
});
