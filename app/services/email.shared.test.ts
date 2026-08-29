import { describe, expect, it } from "vitest";
import {
  firstNameOf,
  getDefaultEmailTemplateContent,
  mergeEmailTemplateContent,
  renderTemplateVariables,
  sanitizeEmailTemplateContentForPlan,
} from "./email.shared";

describe("getDefaultEmailTemplateContent", () => {
  it("reproduces the email's original hardcoded copy and colors", () => {
    const defaults = getDefaultEmailTemplateContent();

    expect(defaults.subject).toBe("How was your {{product_name}}?");
    expect(defaults.heading).toBe("Hi {{customer_name}}, how was your {{product_name}}?");
    expect(defaults.bodyText).toBe(
      "Your feedback helps other shoppers decide with confidence — it only takes a minute.",
    );
    expect(defaults.buttonText).toBe("Write a review");
    expect(defaults.accentColor).toBe("#111111");
    expect(defaults.logoUrl).toBeNull();
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
  const customContent = {
    subject: "Custom subject",
    heading: "Custom heading",
    bodyText: "Custom body",
    buttonText: "Rate it",
    accentColor: "#ff0000",
    logoUrl: "https://example.com/logo.png",
    displayName: "Custom Display Name",
    showStoreName: false,
  };

  it("preserves every base field for a Free (non-advanced) store — the base editor is free for everyone", () => {
    expect(sanitizeEmailTemplateContentForPlan(customContent, false)).toEqual(customContent);
  });

  it("preserves every base field for a Pro (advanced) store identically", () => {
    expect(sanitizeEmailTemplateContentForPlan(customContent, true)).toEqual(customContent);
  });

  it("only ever returns the declared EmailTemplateContent fields, dropping anything else on the input object", () => {
    const withExtra = { ...customContent, someFutureProOnlyField: "smuggled" } as typeof customContent;
    const sanitized = sanitizeEmailTemplateContentForPlan(withExtra, false);

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
