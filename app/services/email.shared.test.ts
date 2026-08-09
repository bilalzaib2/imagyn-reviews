import { describe, expect, it } from "vitest";
import {
  firstNameOf,
  getDefaultEmailTemplateContent,
  mergeEmailTemplateContent,
  renderTemplateVariables,
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
