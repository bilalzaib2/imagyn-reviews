// One-tap star rating in the review-request email.
//
// The reason this file leans so heavily on one property — that all five stars go to the SAME
// form — is that the property is the entire legal difference between a conversion feature and
// review gating. An email offering five clickable stars where the low ones went somewhere
// else (a "tell us privately" form, a support address, nowhere) is review suppression: a
// Shopify App Store violation and an FTC problem, and it is the APP that gets delisted, not
// the merchant. So it is asserted on the real rendered HTML, not on the helper that builds
// the URLs.
//
// Real React Email rendering throughout, no mocks — render() is server-safe and needs no DOM.
import { describe, expect, it } from "vitest";

import { buildReviewRequestEmail } from "./templates.server";
import {
  buildRatingUrl,
  buildRatingUrls,
  getDefaultEmailTemplateContent,
  normalizeEmailSections,
  parseRatingParam,
  validateEmailStarsPrompt,
  EMAIL_STAR_RATINGS,
  RATING_QUERY_PARAM,
  type EmailTemplateContent,
} from "../email.shared";

const REVIEW_URL = "https://app.imagyn.co/r/tok_abc123";

async function renderRequest(overrides: Partial<EmailTemplateContent> = {}, withStars = true) {
  return buildReviewRequestEmail({
    customerName: "Jordan Avery",
    productName: "Coastal Linen Jacket",
    storeName: "Coastal Threads",
    reviewUrl: REVIEW_URL,
    ratingUrls: withStars ? buildRatingUrls(REVIEW_URL) : null,
    customMessage: null,
    template: { ...getDefaultEmailTemplateContent("review_request"), ...overrides },
  });
}

/** Pulls every href out of rendered HTML. */
function hrefsIn(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
}

describe("buildRatingUrl / buildRatingUrls", () => {
  it("offers exactly five ratings, lowest first", () => {
    expect(EMAIL_STAR_RATINGS).toEqual([1, 2, 3, 4, 5]);
    expect(buildRatingUrls(REVIEW_URL)).toEqual([
      `${REVIEW_URL}?r=1`,
      `${REVIEW_URL}?r=2`,
      `${REVIEW_URL}?r=3`,
      `${REVIEW_URL}?r=4`,
      `${REVIEW_URL}?r=5`,
    ]);
  });

  // THE property. Every rating differs only in the query parameter — same origin, same path,
  // same token. Asserted on the URLs as a unit test and again on the rendered email below.
  it("sends every rating to one identical form", () => {
    const paths = buildRatingUrls(REVIEW_URL).map((url) => url.split("?")[0]);
    expect(new Set(paths).size).toBe(1);
    expect(paths[0]).toBe(REVIEW_URL);
  });

  it("appends correctly to a URL that already has a query string", () => {
    expect(buildRatingUrl("https://example.com/r/tok?utm_source=email", 3)).toBe(
      "https://example.com/r/tok?utm_source=email&r=3",
    );
  });

  it("rejects a rating outside the offered set rather than building a dead link", () => {
    for (const rating of [0, 6, -1, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildRatingUrl(REVIEW_URL, rating)).toThrow(/Rating must be one of/);
    }
  });
});

describe("parseRatingParam — a public page reading an editable link", () => {
  it("accepts the five real ratings", () => {
    for (const rating of EMAIL_STAR_RATINGS) {
      expect(parseRatingParam(String(rating))).toBe(rating);
    }
  });

  // Every one of these degrades to "no pre-selection". None may throw: this runs in a loader
  // on an unauthenticated page a customer reached from their inbox, and an error page is a
  // review that never gets written.
  it.each([
    null,
    undefined,
    "",
    "   ",
    "0",
    "6",
    "-1",
    "4.5",
    "5e0",
    "0x5",
    "+5",
    "five",
    "<script>alert(1)</script>",
    "5; DROP TABLE Review",
    "1 OR 1=1",
    "99999999999999999999",
  ])("ignores %j", (value) => {
    expect(parseRatingParam(value as string | null)).toBeNull();
  });

  // Trimmed before parsing, deliberately: whitespace around an otherwise valid rating is a
  // copy-paste artefact, not an attack, and rejecting it would throw away a real choice the
  // customer made. Everything else non-numeric is still refused.
  it("tolerates surrounding whitespace", () => {
    expect(parseRatingParam(" 5 ")).toBe(5);
    expect(parseRatingParam("\n3")).toBe(3);
  });

  it("round-trips what the email actually puts in the link", () => {
    for (const url of buildRatingUrls(REVIEW_URL)) {
      const value = new URL(url).searchParams.get(RATING_QUERY_PARAM);
      expect(parseRatingParam(value)).not.toBeNull();
    }
  });
});

describe("validateEmailStarsPrompt — the gating guard rail", () => {
  it.each([
    "Loved it? Leave us 5 stars!",
    "Give us five stars if you were happy",
    "Click five-star if you liked it",
    "Leave a positive review and get 10% off",
    "If you had a good review to share, tap below",
    "We'd love a great review",
    "Only if you enjoyed it",
  ])("rejects %j", (prompt) => {
    expect(validateEmailStarsPrompt(prompt)).toMatch(/review gating/);
  });

  it.each([
    "How many stars would you give it?",
    "Tap a star to start",
    "What would you rate it?",
    "Rate your purchase honestly — whatever your experience",
    "",
  ])("allows neutral copy %j", (prompt) => {
    expect(validateEmailStarsPrompt(prompt)).toBeNull();
  });

  it("allows the shipped default on every template type that renders the row", () => {
    for (const type of ["review_request", "reminder_1", "reminder_final"] as const) {
      expect(validateEmailStarsPrompt(getDefaultEmailTemplateContent(type).starsPrompt)).toBeNull();
    }
  });
});

describe("the section contract", () => {
  it("places the star row immediately before the review button by default", () => {
    const ids = getDefaultEmailTemplateContent().sections.map((section) => section.id);
    expect(ids[ids.indexOf("stars") + 1]).toBe("button");
  });

  it("is on by default for the request and both reminders", () => {
    for (const type of ["review_request", "reminder_1", "reminder_final"] as const) {
      const stars = getDefaultEmailTemplateContent(type).sections.find((section) => section.id === "stars");
      expect(stars?.enabled, `${type} should ship with the star row on`).toBe(true);
    }
  });

  // The reward email's CTA is the merchant's storefront, not a review form, so there is no
  // rating for a star to carry. Off in the contract rather than left as a toggle that does
  // nothing.
  it("is off for the reward template", () => {
    const stars = getDefaultEmailTemplateContent("reward").sections.find((section) => section.id === "stars");
    expect(stars?.enabled).toBe(false);
  });

  // CONTRACT CHANGE (approved 2026-11-06): a template saved before the star row existed gets
  // it back-filled in canonical position but switched OFF, so an existing merchant's live
  // email does not gain a block they never asked for. New installs — which have no saved row
  // and therefore render DEFAULT_EMAIL_SECTIONS directly — still get it on.
  //
  // The full rollout contract, from every direction a real store can arrive from, is pinned in
  // emailStarRollout.test.ts. This is the one-line version, kept here next to the renderer it
  // affects.
  it("is appended in canonical position but OFF for a template saved before it existed", () => {
    const legacy = normalizeEmailSections([
      { id: "logo", enabled: true },
      { id: "heading", enabled: true },
      { id: "body", enabled: true },
      { id: "button", enabled: true },
    ]);

    expect(legacy.find((section) => section.id === "stars")).toEqual({ id: "stars", enabled: false });
    const ids = legacy.map((section) => section.id);
    expect(ids[ids.indexOf("stars") + 1]).toBe("button");
  });
});

describe("the rendered email", () => {
  it("renders five stars, each pre-selecting its own rating", async () => {
    const { html } = await renderRequest();
    const starLinks = hrefsIn(html).filter((href) => href.includes(`${RATING_QUERY_PARAM}=`));

    expect(starLinks).toHaveLength(5);
    expect(starLinks).toEqual(buildRatingUrls(REVIEW_URL));
  });

  // The same property as the unit test above, asserted where it actually matters: on the
  // markup that reaches a customer's inbox.
  it("points every star at the identical form", async () => {
    const { html } = await renderRequest();
    const starLinks = hrefsIn(html).filter((href) => href.includes(`${RATING_QUERY_PARAM}=`));

    const destinations = new Set(starLinks.map((href) => href.split("?")[0]));
    expect(destinations).toEqual(new Set([REVIEW_URL]));
  });

  it("labels each star for a screen reader and the plain-text alternative", async () => {
    const { html } = await renderRequest();
    for (const rating of EMAIL_STAR_RATINGS) {
      expect(html).toContain(`Rate ${rating} out of 5`);
    }
  });

  it("renders the merchant's star line above the row", async () => {
    const { html, text } = await renderRequest({ starsPrompt: "How was the fit?" });
    expect(html).toContain("How was the fit?");
    expect(text).toContain("How was the fit?");
  });

  it("substitutes variables in the star line like every other copy field", async () => {
    const { html } = await renderRequest({ starsPrompt: "{{customer_name}}, rate your {{product_name}}" });
    expect(html).toContain("Jordan");
    expect(html).not.toContain("{{customer_name}}");
    expect(html).not.toContain("{{product_name}}");
  });

  it("still renders the full review button — the star row is an addition, not a replacement", async () => {
    const defaults = getDefaultEmailTemplateContent();
    const { html } = await renderRequest();

    expect(html).toContain(defaults.buttonText);
    expect(hrefsIn(html)).toContain(REVIEW_URL);
  });

  // Drawn with a glyph rather than five remote images on purpose: Apple Mail and Outlook both
  // block remote content by default on first open, and an image star row degrades to five
  // broken-image icons. This pins that decision — a future change to <img> stars would be a
  // silent regression for every recipient with images off.
  it("draws the stars as text, so they survive blocked remote images", async () => {
    const { html } = await renderRequest();
    expect(html).toContain("★");

    const starRowImages = [...html.matchAll(/<img[^>]*>/g)].filter((match) => /star/i.test(match[0]));
    expect(starRowImages).toHaveLength(0);
  });

  it("uses the template's accent colour for the stars", async () => {
    const { html } = await renderRequest({ accentColor: "#5c9754" });
    expect(html).toContain("#5c9754");
  });
});

describe("the rendered email — when the row must not appear", () => {
  it("omits the row entirely when the caller passes no rating URLs", async () => {
    const { html } = await renderRequest({}, false);

    expect(hrefsIn(html).filter((href) => href.includes(`${RATING_QUERY_PARAM}=`))).toHaveLength(0);
    // ...and nothing is left behind where it would have been.
    expect(html).not.toContain(getDefaultEmailTemplateContent().starsPrompt);
  });

  // A reward send reuses this renderer with the merchant's STOREFRONT url as its CTA. Stars
  // there would carry a rating to a page with no review form on it.
  it("omits the row for a reward send", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Coastal Linen Jacket",
      storeName: "Coastal Threads",
      reviewUrl: "https://coastalthreads.com",
      customMessage: null,
      discountCode: "THANKS-10",
      template: getDefaultEmailTemplateContent("reward"),
    });

    expect(hrefsIn(html).filter((href) => href.includes(`${RATING_QUERY_PARAM}=`))).toHaveLength(0);
    expect(html).toContain("THANKS-10");
  });

  it("omits the row when the merchant switched the section off", async () => {
    const defaults = getDefaultEmailTemplateContent();
    const { html } = await renderRequest({
      sections: defaults.sections.map((section) =>
        section.id === "stars" ? { ...section, enabled: false } : section,
      ),
    });

    expect(hrefsIn(html).filter((href) => href.includes(`${RATING_QUERY_PARAM}=`))).toHaveLength(0);
    // The button is required and unaffected.
    expect(html).toContain(defaults.buttonText);
  });

  // Custom HTML replaces the entire structured body by design, so the star row goes with it —
  // the merchant has taken over the layout, and the compliance footer is all that survives.
  it("omits the row in custom-HTML mode", async () => {
    const { html } = await renderRequest({
      customHtmlEnabled: true,
      customHtml: "<p>My own markup</p>",
    });

    expect(html).toContain("My own markup");
    expect(hrefsIn(html).filter((href) => href.includes(`${RATING_QUERY_PARAM}=`))).toHaveLength(0);
    // The guaranteed route to the form is still there.
    expect(hrefsIn(html)).toContain(REVIEW_URL);
  });
});
