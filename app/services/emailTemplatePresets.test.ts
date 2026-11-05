// Email Studio template library.
//
// Nearly every test here is about what a preset DOESN'T touch. Applying a template is the
// single most destructive-looking button in Email Studio — a merchant clicks it expecting a
// restyle, and the thing that would lose their trust permanently is finding their own copy,
// their logo or their reply-to address rewritten. The preset contract in
// emailTemplatePresets.ts promises that cannot happen; these are the tests that hold it to it.
import { describe, expect, it } from "vitest";

import {
  getDefaultEmailTemplateContent,
  normalizeEmailTemplateContent,
  type EmailTemplateContent,
} from "./email.shared";
import {
  applyEmailTemplatePreset,
  EMAIL_TEMPLATE_PRESETS,
  getEmailTemplatePreset,
  isEmailTemplatePresetId,
  matchEmailTemplatePreset,
  type EmailTemplatePresetId,
} from "./emailTemplatePresets";

/** A heavily customised template — the realistic worst case for an accidental overwrite. */
function customisedContent(): EmailTemplateContent {
  return {
    ...getDefaultEmailTemplateContent("review_request"),
    subject: "Sarah, how's the linen jacket?",
    previewText: "Two minutes, and it genuinely helps us.",
    heading: "We'd love your thoughts",
    bodyText: "Hi {{customer_name}},\n\nOur own words, written by the merchant.",
    closingText: "Warmly,\nThe Coastal Threads team",
    buttonText: "Leave a review",
    logoUrl: "https://cdn.shopify.com/s/files/1/brand/coastal.png",
    logoDarkUrl: "https://cdn.shopify.com/s/files/1/brand/coastal-dark.png",
    logoSource: "custom",
    logoWidth: 180,
    displayName: "Coastal Threads",
    replyToEmail: "hello@coastalthreads.com",
    showStoreName: false,
    showPoweredBy: false,
    customHtmlEnabled: true,
    customHtml: "<p>Hand-written markup</p>",
  };
}

const PRESET_IDS = EMAIL_TEMPLATE_PRESETS.map((preset) => preset.id);

describe("the library itself", () => {
  it("ships the five documented directions", () => {
    expect(PRESET_IDS).toEqual(["minimal", "modern", "editorial", "classic", "showcase"]);
  });

  it("gives every preset a name, a description and scannable traits", () => {
    for (const preset of EMAIL_TEMPLATE_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(20);
      expect(preset.traits.length).toBeGreaterThanOrEqual(3);
    }
  });

  // A gallery of five near-identical emails would be worse than no gallery: it would imply
  // the merchant had made a meaningful choice when they had not. Each one has to differ from
  // every other in more than a single knob.
  it("makes every pair of presets differ in at least three presentation fields", () => {
    for (const a of EMAIL_TEMPLATE_PRESETS) {
      for (const b of EMAIL_TEMPLATE_PRESETS) {
        if (a.id === b.id) continue;
        const differing = (Object.keys(a.presentation) as Array<keyof typeof a.presentation>).filter(
          (key) => a.presentation[key] !== b.presentation[key],
        );
        expect(
          differing.length,
          `${a.id} and ${b.id} differ in only: ${differing.join(", ") || "nothing"}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("only ever proposes values the content contract accepts", () => {
    // Every preset's output must survive the contract's own clamping untouched. A preset with
    // a 900px width or an invalid enum would otherwise be silently rewritten on save, and the
    // email a merchant previewed would not be the email they got.
    for (const preset of EMAIL_TEMPLATE_PRESETS) {
      const applied = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), preset.id);
      expect(normalizeEmailTemplateContent(applied)).toEqual(applied);
    }
  });

  it("recognises its own ids and rejects anything else", () => {
    for (const id of PRESET_IDS) expect(isEmailTemplatePresetId(id)).toBe(true);
    for (const value of ["", "MINIMAL", "bold", null, undefined, 3, {}]) {
      expect(isEmailTemplatePresetId(value)).toBe(false);
    }
  });

  it("throws rather than returning undefined for an unknown id", () => {
    expect(() => getEmailTemplatePreset("nope" as EmailTemplatePresetId)).toThrow(/Unknown email template preset/);
  });
});

describe("applying a preset — what changes", () => {
  it("takes the preset's presentation", () => {
    const applied = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), "editorial");
    const { presentation } = getEmailTemplatePreset("editorial");

    expect(applied.fontFamily).toBe(presentation.fontFamily);
    expect(applied.contentWidth).toBe(presentation.contentWidth);
    expect(applied.cornerRadius).toBe(presentation.cornerRadius);
    expect(applied.buttonStyle).toBe(presentation.buttonStyle);
    expect(applied.buttonAlign).toBe(presentation.buttonAlign);
    expect(applied.density).toBe(presentation.density);
    expect(applied.headingSize).toBe(presentation.headingSize);
    expect(applied.bodySize).toBe(presentation.bodySize);
    expect(applied.theme).toBe(presentation.theme);
  });

  it("is pure — the caller's draft is not mutated", () => {
    const original = customisedContent();
    const snapshot = structuredClone(original);

    applyEmailTemplatePreset(original, "showcase");

    expect(original).toEqual(snapshot);
  });

  it("Minimal restores exactly the shipped default presentation", () => {
    const wandered = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), "editorial");
    const back = applyEmailTemplatePreset(wandered, "minimal");
    const shipped = getDefaultEmailTemplateContent();

    for (const key of [
      "accentColor",
      "buttonTextColor",
      "theme",
      "fontFamily",
      "headingSize",
      "bodySize",
      "density",
      "contentWidth",
      "cornerRadius",
      "buttonStyle",
      "buttonAlign",
    ] as const) {
      expect(back[key]).toBe(shipped[key]);
    }
  });
});

describe("applying a preset — what must survive", () => {
  const PRESERVED = [
    "subject",
    "previewText",
    "heading",
    "bodyText",
    "closingText",
    "buttonText",
    "logoUrl",
    "logoDarkUrl",
    "logoSource",
    "logoWidth",
    "displayName",
    "replyToEmail",
    "showStoreName",
    "showPoweredBy",
    "customHtmlEnabled",
    "customHtml",
  ] as const;

  it.each(PRESET_IDS)("%s leaves the merchant's copy, logo, identity and HTML alone", (id) => {
    const before = customisedContent();
    const after = applyEmailTemplatePreset(before, id);

    for (const key of PRESERVED) {
      expect(after[key], `${id} overwrote ${key}`).toEqual(before[key]);
    }
  });

  // The one plan-enforced field in the whole contract. A preset must never be a side door
  // around sanitizeEmailTemplateContentForPlan — not because a preset could actually defeat
  // it (the save path re-forces it), but because a Free merchant seeing the footer vanish in
  // the preview and reappear in their inbox is a bug report either way.
  it("never touches showPoweredBy, in either direction", () => {
    for (const id of PRESET_IDS) {
      expect(applyEmailTemplatePreset({ ...customisedContent(), showPoweredBy: true }, id).showPoweredBy).toBe(true);
      expect(applyEmailTemplatePreset({ ...customisedContent(), showPoweredBy: false }, id).showPoweredBy).toBe(false);
    }
  });

  it("keeps the merchant's colours when asked to", () => {
    const before = { ...customisedContent(), accentColor: "#c026d3", buttonTextColor: "#fefce8" };

    for (const id of PRESET_IDS) {
      const after = applyEmailTemplatePreset(before, id, { preserveColors: true });
      expect(after.accentColor).toBe("#c026d3");
      expect(after.buttonTextColor).toBe("#fefce8");
      // ...while still restyling everything else.
      expect(after.contentWidth).toBe(getEmailTemplatePreset(id).presentation.contentWidth);
    }
  });

  it("takes the preset's colours by default", () => {
    const after = applyEmailTemplatePreset({ ...customisedContent(), accentColor: "#c026d3" }, "modern");
    expect(after.accentColor).toBe(getEmailTemplatePreset("modern").presentation.accentColor);
  });
});

describe("the product block and section order", () => {
  it("Product Showcase enables the product block and leads with it", () => {
    const after = applyEmailTemplatePreset({ ...getDefaultEmailTemplateContent(), showProduct: false }, "showcase");

    expect(after.showProduct).toBe(true);
    const ids = after.sections.map((section) => section.id);
    expect(ids.indexOf("product")).toBeLessThan(ids.indexOf("heading"));
    expect(ids.indexOf("product")).toBeLessThan(ids.indexOf("body"));
  });

  // The exception is deliberately one-directional. A merchant who turned the product block
  // off — say because they sell one unphotographed service — must not have it reinstated by
  // choosing a serif.
  it("no other preset can switch the product block on", () => {
    for (const id of PRESET_IDS.filter((value) => value !== "showcase")) {
      const after = applyEmailTemplatePreset({ ...getDefaultEmailTemplateContent(), showProduct: false }, id);
      expect(after.showProduct, `${id} switched the product block back on`).toBe(false);
    }
  });

  it("no preset can switch the product block off", () => {
    for (const id of PRESET_IDS) {
      const after = applyEmailTemplatePreset({ ...getDefaultEmailTemplateContent(), showProduct: true }, id);
      expect(after.showProduct).toBe(true);
    }
  });

  it("carries disabled sections across a reorder rather than re-enabling them", () => {
    const before: EmailTemplateContent = {
      ...getDefaultEmailTemplateContent(),
      sections: [
        { id: "logo", enabled: false },
        { id: "storeName", enabled: true },
        { id: "heading", enabled: true },
        { id: "body", enabled: true },
        { id: "product", enabled: true },
        { id: "button", enabled: true },
        { id: "closing", enabled: false },
      ],
    };

    const after = applyEmailTemplatePreset(before, "showcase");

    expect(after.sections.find((section) => section.id === "logo")?.enabled).toBe(false);
    expect(after.sections.find((section) => section.id === "closing")?.enabled).toBe(false);
  });

  it("reorders without adding, dropping or duplicating a section", () => {
    const before = getDefaultEmailTemplateContent();
    const after = applyEmailTemplatePreset(before, "showcase");

    expect(after.sections.map((section) => section.id).sort()).toEqual(
      before.sections.map((section) => section.id).sort(),
    );
  });

  it("leaves section order untouched for every preset that does not reorder", () => {
    const before = customisedContent();
    for (const id of PRESET_IDS.filter((value) => value !== "showcase")) {
      expect(applyEmailTemplatePreset(before, id).sections).toEqual(before.sections);
    }
  });

  // The required-section guarantee belongs to normalizeEmailSections, but the reorder path is
  // a new way to reach it, so it is worth pinning here too: no preset may produce an email
  // with no way to leave a review.
  it("keeps the review button enabled even if the incoming draft claims otherwise", () => {
    const before: EmailTemplateContent = {
      ...getDefaultEmailTemplateContent(),
      sections: [{ id: "button", enabled: false }],
    };

    const after = applyEmailTemplatePreset(before, "showcase");
    expect(after.sections.find((section) => section.id === "button")?.enabled).toBe(true);
  });
});

describe("matchEmailTemplatePreset", () => {
  it("identifies a freshly applied preset", () => {
    for (const id of PRESET_IDS) {
      expect(matchEmailTemplatePreset(applyEmailTemplatePreset(customisedContent(), id))).toBe(id);
    }
  });

  it("reports the shipped default as Minimal, for every template type", () => {
    for (const type of ["review_request", "reminder_1", "reminder_final", "reward"] as const) {
      expect(matchEmailTemplatePreset(getDefaultEmailTemplateContent(type))).toBe("minimal");
    }
  });

  it("ignores copy entirely — rewritten words do not leave a style", () => {
    const styled = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), "classic");
    expect(matchEmailTemplatePreset({ ...styled, heading: "Completely different", bodyText: "Rewritten" })).toBe(
      "classic",
    );
  });

  it("returns null once the merchant has edited away from every preset", () => {
    const edited = { ...applyEmailTemplatePreset(getDefaultEmailTemplateContent(), "modern"), contentWidth: 501 };
    expect(matchEmailTemplatePreset(edited)).toBeNull();
  });

  // Documents the deliberate choice in matchEmailTemplatePreset's header: it would be friendlier
  // to keep showing "Modern" after a brand-colour change, and it would also be a lie about what
  // the email looks like.
  it("stops matching when the accent colour is changed to the merchant's own", () => {
    const branded = { ...applyEmailTemplatePreset(getDefaultEmailTemplateContent(), "modern"), accentColor: "#c026d3" };
    expect(matchEmailTemplatePreset(branded)).toBeNull();
  });

  it("matches again when colours were deliberately preserved and happened to already match", () => {
    const base = applyEmailTemplatePreset(getDefaultEmailTemplateContent(), "modern");
    const reapplied = applyEmailTemplatePreset(base, "modern", { preserveColors: true });
    expect(matchEmailTemplatePreset(reapplied)).toBe("modern");
  });
});
