// Email Studio, end to end.
//
// Every other test in this area checks one layer. This one walks the whole path a merchant
// actually takes, with no mocks anywhere:
//
//   pick a template style  ->  applyEmailTemplatePreset
//   the editor's draft     ->  normalizeEmailTemplateContent / sanitizeEmailTemplateContentForPlan
//   the live preview       ->  buildReviewRequestEmail  (the SAME function the real send uses)
//   the delivered email    ->  the rendered HTML and plain-text bodies
//
// The point is that the preview pane and the real send share one renderer, so "it looked right
// in the preview" is a meaningful statement. A regression that split those two apart would be
// invisible to every layer-specific test and immediately visible here.
import { describe, expect, it } from "vitest";

import { buildReviewRequestEmail } from "./templates.server";
import {
  buildRatingUrls,
  getDefaultEmailTemplateContent,
  normalizeEmailTemplateContent,
  sanitizeEmailTemplateContentForPlan,
  type EmailTemplateContent,
  type EmailTemplateType,
} from "../email.shared";
import {
  applyEmailTemplatePreset,
  EMAIL_TEMPLATE_PRESETS,
  matchEmailTemplatePreset,
} from "../emailTemplatePresets";

const REVIEW_URL = "https://app.imagyn.co/r/tok_e2e";
const STORE = "Coastal Threads";

/** The store's shared Email Branding, as app.email-studio.tsx's loader passes it. */
const BRANDING = {
  emailLogoUrl: "https://cdn.shopify.com/s/files/1/brand/coastal.png",
  emailLogoDarkUrl: null,
  shopBrandLogoUrl: null,
};

/**
 * Renders a draft exactly as both the preview action and the real send do.
 *
 * The two call sites differ only in where `template` comes from (an in-memory draft vs. the
 * saved row) and whether an unsubscribe URL exists, so going through this one helper is a
 * faithful stand-in for either.
 */
async function renderDraft(draft: EmailTemplateContent, type: EmailTemplateType = "review_request") {
  return buildReviewRequestEmail({
    customerName: "Jordan Avery",
    productName: "Coastal Linen Jacket",
    productImageUrl: "https://cdn.shopify.com/s/files/1/products/jacket.jpg",
    storeName: STORE,
    reviewUrl: REVIEW_URL,
    ratingUrls: type === "reward" ? null : buildRatingUrls(REVIEW_URL),
    customMessage: null,
    template: draft,
    branding: BRANDING,
    unsubscribeUrl: "https://app.imagyn.co/unsubscribe?t=tok_e2e",
  });
}

/** What the Email Studio save action does to a draft before it is persisted. */
function asSaved(draft: EmailTemplateContent, canUseCustomBranding = true): EmailTemplateContent {
  return normalizeEmailTemplateContent(sanitizeEmailTemplateContentForPlan(draft, { canUseCustomBranding }));
}

describe("every shipped style produces a complete, send-ready email", () => {
  it.each(EMAIL_TEMPLATE_PRESETS.map((preset) => preset.id))("%s", async (presetId) => {
    const draft = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), presetId);
    const { subject, html, text } = await renderDraft(asSaved(draft));

    // The four things that make an email send-ready at all.
    expect(subject.trim().length).toBeGreaterThan(0);
    expect(html).toContain(draft.buttonText);
    expect(html).toContain(REVIEW_URL);
    expect(text.trim().length).toBeGreaterThan(0);

    // No raw token may ever reach an inbox.
    expect(html).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i);
    expect(text).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i);

    // The merchant's real data, substituted.
    expect(html).toContain("Jordan");
    expect(html).toContain("Coastal Linen Jacket");

    // The compliance furniture a merchant cannot opt out of.
    expect(html).toContain("unsubscribe?t=tok_e2e");
  });

  // The whole point of the style gallery: five visibly different emails, not five variations
  // of one. Compared on rendered markup rather than on the preset definitions, because that
  // is what a customer receives.
  it("renders five genuinely different emails", async () => {
    const bodies = await Promise.all(
      EMAIL_TEMPLATE_PRESETS.map(async (preset) => {
        const { html } = await renderDraft(asSaved(applyEmailTemplatePreset(getDefaultEmailTemplateContent(), preset.id)));
        return html;
      }),
    );

    expect(new Set(bodies).size).toBe(EMAIL_TEMPLATE_PRESETS.length);
  });

  it("carries each style's own measure, corners and button treatment into the markup", async () => {
    for (const preset of EMAIL_TEMPLATE_PRESETS) {
      const draft = asSaved(applyEmailTemplatePreset(getDefaultEmailTemplateContent(), preset.id));
      const { html } = await renderDraft(draft);

      expect(html).toContain(`${preset.presentation.contentWidth}px`);
      expect(html).toContain(preset.presentation.accentColor);

      if (preset.presentation.fontFamily === "serif") {
        expect(html).toContain("Georgia");
      }
      if (preset.presentation.buttonStyle === "outline") {
        expect(html).toContain(`1px solid ${preset.presentation.accentColor}`);
      }
    }
  });
});

describe("a style survives the round trip the merchant actually makes", () => {
  // Apply -> save (normalize + plan sanitize) -> read back. If any of those three steps
  // rewrote a value, the email the merchant previewed is not the email that ships.
  it("is not rewritten by save and reload", () => {
    for (const preset of EMAIL_TEMPLATE_PRESETS) {
      const applied = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), preset.id);
      const saved = asSaved(applied);

      expect(saved).toEqual(applied);
      // ...and the gallery still shows the merchant which style they are on.
      expect(matchEmailTemplatePreset(saved)).toBe(preset.id);
    }
  });

  it("keeps the merchant's own words through a style change", async () => {
    const written: EmailTemplateContent = {
      ...getDefaultEmailTemplateContent(),
      subject: "Sarah, how's the linen jacket?",
      heading: "We'd love your thoughts",
      bodyText: "Hi {{customer_name}},\n\nOur own words, in two paragraphs.",
      closingText: "Warmly,\nThe Coastal Threads team",
      buttonText: "Leave a review",
    };

    const restyled = asSaved(applyEmailTemplatePreset(written, "editorial"));
    const { subject, html, text } = await renderDraft(restyled);

    expect(subject).toBe("Sarah, how's the linen jacket?");
    // Copy is asserted against the PLAIN-TEXT body, not the HTML: React Email entity-escapes
    // apostrophes in markup ("We&#x27;d"), so a literal-apostrophe assertion on the HTML fails
    // on correctly-rendered output. The text alternative is the merchant's words verbatim.
    expect(text).toContain("We'd love your thoughts");
    expect(text).toContain("Our own words, in two paragraphs.");
    expect(text).toContain("Leave a review");
    // ...while genuinely restyling it.
    expect(html).toContain("Georgia");
    expect(html).toContain("max-width:640px");
  });

  it("keeps the merchant's brand colour when they asked to", async () => {
    const branded = { ...getDefaultEmailTemplateContent(), accentColor: "#c026d3", buttonTextColor: "#ffffff" };
    const restyled = asSaved(applyEmailTemplatePreset(branded, "modern", { preserveColors: true }));
    const { html } = await renderDraft(restyled);

    expect(html).toContain("#c026d3");
    expect(html).not.toContain("#5c9754");
  });
});

describe("merchant branding reaches the rendered email", () => {
  it("uses the store's shared Email Studio logo", async () => {
    const { html } = await renderDraft(asSaved(getDefaultEmailTemplateContent()));
    expect(html).toContain("coastal.png");
  });

  // Tier 3 of the precedence chain — the merchant uploaded nothing, so their Shopify Branding
  // logo is used instead. This is the gap that made a brand-new install's first email look
  // unbranded.
  it("falls back to the Shopify brand logo when nothing was uploaded", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Coastal Linen Jacket",
      storeName: STORE,
      reviewUrl: REVIEW_URL,
      ratingUrls: buildRatingUrls(REVIEW_URL),
      customMessage: null,
      template: getDefaultEmailTemplateContent(),
      branding: { emailLogoUrl: null, emailLogoDarkUrl: null, shopBrandLogoUrl: "https://cdn.shopify.com/shop-logo.png" },
    });

    expect(html).toContain("shop-logo.png");
  });

  it("renders a text brand header, not a broken image, when there is no logo anywhere", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Coastal Linen Jacket",
      storeName: STORE,
      reviewUrl: REVIEW_URL,
      customMessage: null,
      template: getDefaultEmailTemplateContent(),
      branding: { emailLogoUrl: null, emailLogoDarkUrl: null, shopBrandLogoUrl: null },
    });

    expect(html).toContain(STORE);
    expect(html).not.toContain("<img src=\"\"");
  });

  it("honours a merchant's friendlier display name in the body without touching the sender", async () => {
    const draft = { ...getDefaultEmailTemplateContent(), displayName: "Coastal" };
    const { html } = await renderDraft(asSaved(draft));

    expect(html).toContain("Coastal");
  });
});

describe("the plan gate holds at the only place it exists", () => {
  // showPoweredBy is the single entitlement in the whole email contract. Every other field is
  // free on every plan, deliberately.
  it("forces the attribution footer back on for a Free store, whatever the draft says", async () => {
    const draft = { ...getDefaultEmailTemplateContent(), showPoweredBy: false };
    const saved = asSaved(draft, /* canUseCustomBranding */ false);

    expect(saved.showPoweredBy).toBe(true);
    const { html } = await renderDraft(saved);
    expect(html).toContain("Powered by Imagyn Reviews");
  });

  it("lets a Pro store remove it", async () => {
    const draft = { ...getDefaultEmailTemplateContent(), showPoweredBy: false };
    const { html } = await renderDraft(asSaved(draft, true));
    expect(html).not.toContain("Powered by Imagyn Reviews");
  });

  // Applying a style must never be a side door around the gate.
  it("cannot be switched off by applying a style", () => {
    for (const preset of EMAIL_TEMPLATE_PRESETS) {
      const free = asSaved(applyEmailTemplatePreset(getDefaultEmailTemplateContent(), preset.id), false);
      expect(free.showPoweredBy).toBe(true);
    }
  });
});

describe("every template type renders, in both palettes", () => {
  const TYPES: EmailTemplateType[] = ["review_request", "reminder_1", "reminder_final", "reward"];

  it.each(TYPES)("%s renders in light and dark", async (type) => {
    for (const theme of ["light", "dark"] as const) {
      const draft = asSaved({ ...getDefaultEmailTemplateContent(type), theme });
      const { html, text } = await buildReviewRequestEmail({
        customerName: "Jordan Avery",
        productName: "Coastal Linen Jacket",
        storeName: STORE,
        reviewUrl: REVIEW_URL,
        ratingUrls: type === "reward" ? null : buildRatingUrls(REVIEW_URL),
        customMessage: null,
        discountCode: type === "reward" ? "THANKS-10" : undefined,
        template: draft,
        branding: BRANDING,
      });

      expect(html).toContain(`content="${theme}"`);
      expect(text).not.toMatch(/\{\{\s*[a-z_]+\s*\}\}/i);
      expect(html).toContain(draft.buttonText);
    }
  });

  it("substitutes the real discount code into a reward send", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Coastal Linen Jacket",
      storeName: STORE,
      reviewUrl: "https://coastalthreads.com",
      customMessage: null,
      discountCode: "THANKS-10",
      template: getDefaultEmailTemplateContent("reward"),
      branding: BRANDING,
    });

    expect(html).toContain("THANKS-10");
    expect(html).not.toContain("{{discount_code}}");
  });
});

describe("custom HTML mode", () => {
  it("replaces the body but never the compliance footer", async () => {
    const draft = asSaved({
      ...getDefaultEmailTemplateContent(),
      customHtmlEnabled: true,
      customHtml: "<p>Hand-written markup for {{customer_name}}</p>",
    });

    const { html } = await renderDraft(draft);

    expect(html).toContain("Hand-written markup for Jordan");
    expect(html).toContain("unsubscribe?t=tok_e2e");
    expect(html).toContain("Powered by Imagyn Reviews");
    // The guaranteed route to the form survives too.
    expect(html).toContain(REVIEW_URL);
  });

  it("strips script out of merchant markup on the way to the inbox", async () => {
    const draft = asSaved({
      ...getDefaultEmailTemplateContent(),
      customHtmlEnabled: true,
      customHtml: '<p onclick="steal()">Hi</p><script>alert(1)</script>',
    });

    const { html } = await renderDraft(draft);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("Hi");
  });
});
