import { describe, expect, it } from "vitest";
import {
  CONTENT_WIDTH_RANGE,
  DEFAULT_EMAIL_SECTIONS,
  EMAIL_TEMPLATE_TYPES,
  findUnknownVariables,
  normalizeEmailSections,
  normalizeEmailTemplateContent,
  firstNameOf,
  getDefaultEmailTemplateContent,
  mergeEmailTemplateContent,
  renderTemplateVariables,
  sanitizeEmailTemplateContentForPlan,
} from "./email.shared";

// The shipped defaults are part of the product: a merchant who never opens Email Studio
// still sends these. They are asserted on the properties that must hold, not on exact
// wording — the copy is product-owned and expected to be revised.
describe("getDefaultEmailTemplateContent", () => {
  it("ships complete, send-ready copy for every template type", () => {
    for (const type of EMAIL_TEMPLATE_TYPES) {
      const defaults = getDefaultEmailTemplateContent(type);

      expect(defaults.subject.trim()).not.toBe("");
      expect(defaults.previewText.trim()).not.toBe("");
      expect(defaults.heading.trim()).not.toBe("");
      expect(defaults.bodyText.trim()).not.toBe("");
      expect(defaults.buttonText.trim()).not.toBe("");
      expect(defaults.closingText.trim()).not.toBe("");
    }
  });

  it("uses only resolvable variables, so a default send can never ship a raw token", () => {
    for (const type of EMAIL_TEMPLATE_TYPES) {
      const defaults = getDefaultEmailTemplateContent(type);
      const fields = [defaults.subject, defaults.previewText, defaults.heading, defaults.bodyText, defaults.closingText];

      for (const field of fields) {
        expect(findUnknownVariables(field, type)).toEqual([]);
      }
    }
  });

  it("asks for honest feedback and never conditions anything on a positive rating", () => {
    // Review-gating — soliciting only happy customers, or trading a reward for a good score —
    // violates both the Shopify App Store rules and the FTC's endorsement guides. Encoding it
    // as a test keeps a future copy edit from quietly reintroducing it.
    const banned = [/positive review/i, /5[- ]star review/i, /five[- ]star review/i, /if you (loved|liked)/i, /in exchange for/i];

    for (const type of EMAIL_TEMPLATE_TYPES) {
      const defaults = getDefaultEmailTemplateContent(type);
      const copy = [defaults.subject, defaults.previewText, defaults.heading, defaults.bodyText, defaults.closingText].join(" ");

      for (const pattern of banned) {
        expect(copy).not.toMatch(pattern);
      }
    }
  });

  it("starts unbranded and on the shared accent, so nothing is assumed about the store", () => {
    const defaults = getDefaultEmailTemplateContent();

    expect(defaults.accentColor).toBe("#111111");
    expect(defaults.logoUrl).toBeNull();
    expect(defaults.logoDarkUrl).toBeNull();
    expect(defaults.theme).toBe("light");
    expect(defaults.customHtmlEnabled).toBe(false);
  });
});

describe("mergeEmailTemplateContent", () => {
  it("fills in missing fields from defaults, so a partial/legacy row never crashes the reader", () => {
    const merged = mergeEmailTemplateContent({ subject: "Custom subject" });

    expect(merged.subject).toBe("Custom subject");
    expect(merged.heading).toBe(getDefaultEmailTemplateContent().heading);
    expect(merged.buttonText).toBe(getDefaultEmailTemplateContent().buttonText);
  });

  it("an empty partial reproduces the full default set", () => {
    expect(mergeEmailTemplateContent({})).toEqual(getDefaultEmailTemplateContent());
  });

  it("fills in missing fields from the given type's own defaults, not review_request's", () => {
    const merged = mergeEmailTemplateContent({ subject: "Custom reminder subject" }, "reminder_1");

    expect(merged.subject).toBe("Custom reminder subject");
    expect(merged.heading).toBe(getDefaultEmailTemplateContent("reminder_1").heading);
    expect(merged.heading).not.toBe(getDefaultEmailTemplateContent("review_request").heading);
  });
});

describe("getDefaultEmailTemplateContent — per type", () => {
  it("reminder_1 and reminder_final each have their own distinct copy", () => {
    const reminder1 = getDefaultEmailTemplateContent("reminder_1");
    const reminderFinal = getDefaultEmailTemplateContent("reminder_final");
    const reviewRequest = getDefaultEmailTemplateContent("review_request");

    expect(reminder1.subject).not.toBe(reviewRequest.subject);
    expect(reminderFinal.subject).not.toBe(reviewRequest.subject);
    expect(reminder1.subject).not.toBe(reminderFinal.subject);
  });

  it("every type's defaults use the same shared accent color and no logo", () => {
    for (const type of ["review_request", "reminder_1", "reminder_final"] as const) {
      const defaults = getDefaultEmailTemplateContent(type);
      expect(defaults.accentColor).toBe("#111111");
      expect(defaults.logoUrl).toBeNull();
    }
  });

  it("defaults with no type argument reproduce review_request's defaults, unchanged", () => {
    expect(getDefaultEmailTemplateContent()).toEqual(getDefaultEmailTemplateContent("review_request"));
  });
});

describe("renderTemplateVariables", () => {
  const values = { customerName: "Jordan", storeName: "Grace Store", productName: "Embroidered Lawn Dress" };

  it("substitutes every declared token", () => {
    const result = renderTemplateVariables(
      "Hi {{customer_name}}, {{store_name}} wants to know about your {{product_name}}.",
      values,
    );

    expect(result).toBe("Hi Jordan, Grace Store wants to know about your Embroidered Lawn Dress.");
  });

  it("leaves text with no tokens untouched", () => {
    expect(renderTemplateVariables("No variables here.", values)).toBe("No variables here.");
  });

  it("substitutes a token that appears more than once", () => {
    expect(renderTemplateVariables("{{customer_name}}! Yes, {{customer_name}}.", values)).toBe("Jordan! Yes, Jordan.");
  });

  it("leaves an unrecognized token as literal text instead of throwing", () => {
    expect(renderTemplateVariables("Hi {{unknown_token}}!", values)).toBe("Hi {{unknown_token}}!");
  });
});

describe("sanitizeEmailTemplateContentForPlan", () => {
  // Built from the real defaults so this fixture stays complete as the contract grows — a
  // hand-written literal would silently drift out of date every time a field is added.
  const customContent = {
    ...getDefaultEmailTemplateContent(),
    subject: "Custom subject",
    heading: "Custom heading",
    bodyText: "Custom body",
    buttonText: "Rate it",
    accentColor: "#ff0000",
    logoUrl: "https://example.com/logo.png",
    displayName: "Custom Display Name",
    showStoreName: false,
    showPoweredBy: false,
    replyToEmail: "custom@example.com",
  };

  const freePermissions = { canUseCustomBranding: false };
  const proPermissions = { canUseCustomBranding: true };

  it("preserves every base field for a Free store — the base editor is free for everyone", () => {
    expect(sanitizeEmailTemplateContentForPlan(customContent, freePermissions)).toEqual({
      ...customContent,
      showPoweredBy: true,
    });
  });

  it("preserves every base field for a Pro store identically, including showPoweredBy: false", () => {
    expect(sanitizeEmailTemplateContentForPlan(customContent, proPermissions)).toEqual(customContent);
  });

  it("force-overwrites showPoweredBy to true for a Free store — a Free store can never remove the footer, regardless of what's persisted", () => {
    const sanitized = sanitizeEmailTemplateContentForPlan(customContent, freePermissions);
    expect(sanitized.showPoweredBy).toBe(true);
  });

  it("only ever returns the declared EmailTemplateContent fields, dropping anything else on the input object", () => {
    const withExtra = { ...customContent, someFutureProOnlyField: "smuggled" } as typeof customContent;
    const sanitized = sanitizeEmailTemplateContentForPlan(withExtra, proPermissions);

    expect(sanitized).toEqual(customContent);
    expect(sanitized).not.toHaveProperty("someFutureProOnlyField");
  });
});

describe("firstNameOf", () => {
  it("extracts the first word of a full name", () => {
    expect(firstNameOf("Jordan Avery")).toBe("Jordan");
  });

  it("returns the whole string when there's only one word", () => {
    expect(firstNameOf("Jordan")).toBe("Jordan");
  });

  it("trims surrounding whitespace and collapses internal whitespace", () => {
    expect(firstNameOf("  Jordan   Avery  ")).toBe("Jordan");
  });
});


// normalizeEmailSections is what stands between a hand-crafted POST and an email with no way
// to leave a review, so it is tested as a repair function rather than a parser: every input
// has to produce a renderable list.
describe("normalizeEmailSections", () => {
  it("fills in the canonical list when given nothing", () => {
    expect(normalizeEmailSections([])).toEqual([...DEFAULT_EMAIL_SECTIONS]);
    expect(normalizeEmailSections(undefined)).toEqual([...DEFAULT_EMAIL_SECTIONS]);
    expect(normalizeEmailSections("not an array")).toEqual([...DEFAULT_EMAIL_SECTIONS]);
  });

  it("keeps a merchant's order", () => {
    const reordered = normalizeEmailSections([
      { id: "heading", enabled: true },
      { id: "logo", enabled: true },
    ]);

    expect(reordered[0].id).toBe("heading");
    expect(reordered[1].id).toBe("logo");
  });

  it("appends sections a previously-saved row predates, so an older template still renders", () => {
    const result = normalizeEmailSections([{ id: "heading", enabled: true }]);
    const ids = result.map((section) => section.id);

    for (const fallback of DEFAULT_EMAIL_SECTIONS) {
      expect(ids).toContain(fallback.id);
    }
  });

  it("drops unknown ids and de-duplicates repeats", () => {
    const result = normalizeEmailSections([
      { id: "heading", enabled: true },
      { id: "heading", enabled: false },
      { id: "definitely-not-a-section", enabled: true },
    ]);

    expect(result.filter((section) => section.id === "heading")).toHaveLength(1);
    expect(result.map((section) => String(section.id))).not.toContain("definitely-not-a-section");
  });

  it("force-enables the review button — an email with no CTA is not a valid review request", () => {
    const result = normalizeEmailSections([{ id: "button", enabled: false }]);
    expect(result.find((section) => section.id === "button")?.enabled).toBe(true);
  });

  it("allows optional sections to be switched off", () => {
    const result = normalizeEmailSections([{ id: "logo", enabled: false }]);
    expect(result.find((section) => section.id === "logo")?.enabled).toBe(false);
  });
});

// The form is a transport, not the authority on what is valid — these are the clamps that
// keep a direct POST from producing an email no client can render.
describe("normalizeEmailTemplateContent", () => {
  const base = getDefaultEmailTemplateContent();

  it("clamps an out-of-range content width into the renderable band", () => {
    expect(normalizeEmailTemplateContent({ ...base, contentWidth: 9000 }).contentWidth).toBe(CONTENT_WIDTH_RANGE.max);
    expect(normalizeEmailTemplateContent({ ...base, contentWidth: 1 }).contentWidth).toBe(CONTENT_WIDTH_RANGE.min);
  });

  it("falls back to the default for a non-numeric width rather than emitting NaN into a style", () => {
    const result = normalizeEmailTemplateContent({ ...base, contentWidth: "wide" as unknown as number });
    expect(result.contentWidth).toBe(base.contentWidth);
  });

  it("rejects an unknown enum value and keeps the default", () => {
    const result = normalizeEmailTemplateContent({ ...base, theme: "neon" as never, density: "airy" as never });

    expect(result.theme).toBe(base.theme);
    expect(result.density).toBe(base.density);
  });

  it("rejects a malformed colour, so no invalid value reaches a style attribute", () => {
    const result = normalizeEmailTemplateContent({ ...base, accentColor: "red; background: url(x)" });
    expect(result.accentColor).toBe(base.accentColor);
  });

  it("normalizes a valid colour to lowercase hex", () => {
    expect(normalizeEmailTemplateContent({ ...base, accentColor: "#FF6600" }).accentColor).toBe("#ff6600");
  });

  it("turns blank optional strings into null rather than empty strings", () => {
    const result = normalizeEmailTemplateContent({ ...base, logoUrl: "   ", displayName: "", replyToEmail: "  " });

    expect(result.logoUrl).toBeNull();
    expect(result.displayName).toBeNull();
    expect(result.replyToEmail).toBeNull();
  });
});

describe("findUnknownVariables", () => {
  it("returns nothing for the declared tokens", () => {
    expect(findUnknownVariables("Hi {{customer_name}} from {{store_name}} about {{product_name}}")).toEqual([]);
  });

  it("flags a typo, which is what stops it reaching a real inbox", () => {
    // renderTemplateVariables deliberately leaves unknown tokens as literal text, so this
    // check at the save boundary is the only thing preventing "Hi {{frist_name}}" being sent.
    expect(findUnknownVariables("Hi {{frist_name}}")).toEqual(["{{frist_name}}"]);
  });

  it("treats {{discount_code}} as known only for the reward template", () => {
    expect(findUnknownVariables("Code: {{discount_code}}", "reward")).toEqual([]);
    expect(findUnknownVariables("Code: {{discount_code}}", "review_request")).toEqual(["{{discount_code}}"]);
  });

  it("reports each unknown token once, however often it appears", () => {
    expect(findUnknownVariables("{{nope}} and {{nope}} again")).toEqual(["{{nope}}"]);
  });
});

// The product promise is "every email-customization control works on Free". This asserts it
// field-by-field with every value deliberately set away from its default, so a future gate
// added to any one of them fails here rather than silently shipping a downgrade.
describe("Free-plan entitlement — the whole editor is free except attribution removal", () => {
  const fullyCustomized = {
    ...getDefaultEmailTemplateContent(),
    subject: "S",
    previewText: "P",
    heading: "H",
    bodyText: "B",
    closingText: "C",
    buttonText: "Go",
    accentColor: "#ff6600",
    buttonTextColor: "#000000",
    theme: "dark" as const,
    fontFamily: "serif" as const,
    headingSize: "large" as const,
    bodySize: "small" as const,
    density: "relaxed" as const,
    contentWidth: 600,
    cornerRadius: 20,
    buttonStyle: "outline" as const,
    buttonAlign: "center" as const,
    logoUrl: "https://cdn.example.com/light.png",
    logoDarkUrl: "https://cdn.example.com/dark.png",
    logoWidth: 120,
    displayName: "Friendly Name",
    showStoreName: false,
    showProduct: false,
    replyToEmail: "hi@example.com",
    sections: [
      { id: "body" as const, enabled: true },
      { id: "heading" as const, enabled: false },
      { id: "button" as const, enabled: true },
    ],
    customHtmlEnabled: true,
    customHtml: "<p>Custom</p>",
  };

  const free = { canUseCustomBranding: false };

  it("preserves every customization field on Free", () => {
    const saved = sanitizeEmailTemplateContentForPlan({ ...fullyCustomized, showPoweredBy: true }, free);

    for (const key of Object.keys(fullyCustomized) as Array<keyof typeof fullyCustomized>) {
      if (key === "showPoweredBy") continue;
      expect(saved[key]).toEqual(fullyCustomized[key]);
    }
  });

  it("blocks only attribution removal on Free, and allows it on Pro", () => {
    expect(sanitizeEmailTemplateContentForPlan({ ...fullyCustomized, showPoweredBy: false }, free).showPoweredBy).toBe(true);
    expect(
      sanitizeEmailTemplateContentForPlan({ ...fullyCustomized, showPoweredBy: false }, { canUseCustomBranding: true })
        .showPoweredBy,
    ).toBe(false);
  });
});
