// Regression coverage for the one behavior that must never change: an unconfigured store's
// review-request email renders byte-for-byte what it always did, before Email Studio existed.
// Real React Email rendering (no mocks) — render() is a server-safe API, no DOM needed.
import { describe, expect, it } from "vitest";
import { buildReviewRequestEmail } from "./templates.server";
import { getDefaultEmailTemplateContent } from "../email.shared";

describe("buildReviewRequestEmail — no template (backward compatibility)", () => {
  it("reproduces the original hardcoded subject/heading/body/button/color", async () => {
    const { subject, html, text } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: null,
    });

    expect(subject).toBe("How was your Embroidered Lawn Dress?");
    expect(html).toContain("Hi Jordan, how was your Embroidered Lawn Dress?");
    expect(html).toContain("Your feedback helps other shoppers decide with confidence");
    expect(html).toContain("Write a review");
    expect(html).toContain("#111111");
    expect(text).toContain("Write a review");
  });

  it("a per-request customMessage still overrides the default body text", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: "Thanks for your recent order — we'd love your thoughts!",
    });

    expect(html).toContain("Thanks for your recent order");
    expect(html).not.toContain("Your feedback helps other shoppers decide with confidence");
  });

  it("falls back to the store's own icon when no logoUrl is set", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: null,
    });

    expect(html).toContain("apple-touch-icon.png");
  });
});

describe("buildReviewRequestEmail — with a saved Email Studio template", () => {
  it("substitutes {{variables}} in the subject/heading and applies custom copy/color/logo", async () => {
    const { subject, html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: null,
      template: {
        subject: "{{store_name}} would love your feedback on {{product_name}}",
        heading: "Hey {{customer_name}}!",
        bodyText: "Would you mind sharing a quick review?",
        buttonText: "Leave feedback",
        accentColor: "#ff6600",
        logoUrl: "https://example.com/merchant-logo.png",
        displayName: null,
        showStoreName: true,
      },
    });

    expect(subject).toBe("Grace Store would love your feedback on Embroidered Lawn Dress");
    expect(html).toContain("Hey Jordan!");
    expect(html).toContain("Would you mind sharing a quick review?");
    expect(html).toContain("Leave feedback");
    expect(html).toContain("#ff6600");
    expect(html).toContain("merchant-logo.png");
    expect(html).not.toContain("apple-touch-icon.png");
  });

  it("a per-request customMessage still overrides the template's own default body text", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: "A note just for this one request.",
      template: { ...getDefaultEmailTemplateContent(), bodyText: "Template default body." },
    });

    expect(html).toContain("A note just for this one request.");
    expect(html).not.toContain("Template default body.");
  });
});
