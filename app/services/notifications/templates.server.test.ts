// Regression coverage for an UNCONFIGURED store's review-request email — the version a
// merchant sends before they ever open Email Studio, which must be complete and send-ready
// on its own. These assert the guarantees that have to hold (every variable resolved, the
// CTA present, the attribution footer intact) rather than exact marketing copy, which is
// product-owned and expected to be rewritten. Real React Email rendering (no mocks) —
// render() is a server-safe API, no DOM needed.
import { describe, expect, it } from "vitest";
import { buildReviewRequestEmail } from "./templates.server";
import { getDefaultEmailTemplateContent } from "../email.shared";

describe("buildReviewRequestEmail — no template (backward compatibility)", () => {
  it("renders the shipped default as a complete, send-ready email", async () => {
    const defaults = getDefaultEmailTemplateContent();
    const { subject, html, text } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: null,
    });

    expect(subject).toBe(defaults.subject);
    expect(html).toContain(defaults.buttonText);
    expect(html).toContain(defaults.accentColor);
    expect(html).toContain("https://example.com/r/sample-token");
    expect(text).toContain(defaults.buttonText);
  });

  it("resolves every variable — an unconfigured send never ships a raw {{token}}", async () => {
    // The failure this guards against is the worst one this feature can produce: a real
    // customer receiving "Hi {{customer_name}}". Checking the rendered output (rather than
    // the template source) is what makes it meaningful.
    const { subject, html, text } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: null,
    });

    for (const output of [subject, html, text]) {
      expect(output).not.toMatch(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/);
    }
    expect(html).toContain("Jordan");
    expect(html).toContain("Embroidered Lawn Dress");
    expect(html).toContain("Grace Store");
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
    // The template's own body copy is replaced, not appended to.
    expect(html).not.toContain(getDefaultEmailTemplateContent().bodyText.split("\n")[0]);
  });

  it("renders no header logo when no logoUrl is set — only the small footer attribution mark", async () => {
    const { html } = await buildReviewRequestEmail({
      customerName: "Jordan Avery",
      productName: "Embroidered Lawn Dress",
      storeName: "Grace Store",
      reviewUrl: "https://example.com/r/sample-token",
      customMessage: null,
    });

    // The Imagyn mark still appears exactly once, in the small "Powered by" footer line — never
    // in the header's primary branding position, so an unbranded email never reads as
    // "sent by Imagyn" to the customer.
    const occurrences = html.split("apple-touch-icon.png").length - 1;
    expect(occurrences).toBe(1);
    expect(html).toContain("Powered by Imagyn Reviews");
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
        ...getDefaultEmailTemplateContent(),
        subject: "{{store_name}} would love your feedback on {{product_name}}",
        heading: "Hey {{customer_name}}!",
        bodyText: "Would you mind sharing a quick review?",
        buttonText: "Leave feedback",
        accentColor: "#ff6600",
        logoUrl: "https://example.com/merchant-logo.png",
        displayName: null,
        showStoreName: true,
        showPoweredBy: true,
        replyToEmail: null,
      },
    });

    expect(subject).toBe("Grace Store would love your feedback on Embroidered Lawn Dress");
    expect(html).toContain("Hey Jordan!");
    expect(html).toContain("Would you mind sharing a quick review?");
    expect(html).toContain("Leave feedback");
    expect(html).toContain("#ff6600");
    expect(html).toContain("merchant-logo.png");
    // The merchant's own logo is the only image in the header — Imagyn's mark still appears
    // exactly once, but only in the small footer attribution line, never competing with it.
    expect(html.split("apple-touch-icon.png").length - 1).toBe(1);
    expect(html).toContain("Powered by Imagyn Reviews");
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

// Integration coverage through the real renderer: these assert what actually lands in the
// customer's inbox for each new Email Studio capability, which unit tests on the content
// contract cannot show.
describe("buildReviewRequestEmail — appearance, sections and custom HTML", () => {
  const base = {
    customerName: "Jordan Avery",
    productName: "Embroidered Lawn Dress",
    storeName: "Grace Store",
    reviewUrl: "https://example.com/r/sample-token",
    customMessage: null,
  };

  it("renders the dark palette and prefers the dark logo", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: {
        ...getDefaultEmailTemplateContent(),
        theme: "dark",
        logoUrl: "https://cdn.example.com/light.png",
        logoDarkUrl: "https://cdn.example.com/dark.png",
      },
    });

    expect(html).toContain("#0e0e10");
    expect(html).toContain("https://cdn.example.com/dark.png");
    expect(html).not.toContain("https://cdn.example.com/light.png");
  });

  it("falls back to the light logo when no dark variant was uploaded", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: {
        ...getDefaultEmailTemplateContent(),
        theme: "dark",
        logoUrl: "https://cdn.example.com/light.png",
        logoDarkUrl: null,
      },
    });

    expect(html).toContain("https://cdn.example.com/light.png");
  });

  it("honours section order", async () => {
    const defaults = getDefaultEmailTemplateContent();
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: {
        ...defaults,
        heading: "HEADING_MARKER",
        bodyText: "BODY_MARKER",
        // Body deliberately placed before heading.
        sections: [
          { id: "body", enabled: true },
          { id: "heading", enabled: true },
          { id: "button", enabled: true },
        ],
      },
    });

    expect(html.indexOf("BODY_MARKER")).toBeLessThan(html.indexOf("HEADING_MARKER"));
  });

  it("omits a disabled section but always keeps the review button", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: {
        ...getDefaultEmailTemplateContent(),
        heading: "HEADING_MARKER",
        buttonText: "BUTTON_MARKER",
        sections: [
          { id: "heading", enabled: false },
          // Disabling the CTA is rejected by normalizeEmailSections, so it still renders.
          { id: "button", enabled: false },
        ],
      },
    });

    expect(html).not.toContain("HEADING_MARKER");
    expect(html).toContain("BUTTON_MARKER");
  });

  it("renders the product block only when the send actually has a product", async () => {
    const template = { ...getDefaultEmailTemplateContent(), showProduct: true };

    const withProduct = await buildReviewRequestEmail({
      ...base,
      template,
      productImageUrl: "https://cdn.example.com/product.jpg",
    });
    expect(withProduct.html).toContain("Your purchase");
    expect(withProduct.html).toContain("https://cdn.example.com/product.jpg");

    // No product name on the send: the block is skipped rather than rendering an empty frame.
    const withoutProduct = await buildReviewRequestEmail({ ...base, productName: "", template });
    expect(withoutProduct.html).not.toContain("Your purchase");
  });

  it("hides the product block when the merchant switched it off", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: { ...getDefaultEmailTemplateContent(), showProduct: false },
      productImageUrl: "https://cdn.example.com/product.jpg",
    });

    expect(html).not.toContain("Your purchase");
    expect(html).not.toContain("https://cdn.example.com/product.jpg");
  });

  it("renders custom HTML, strips script from it, and still appends the compliance footer", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      unsubscribeUrl: "https://example.com/unsubscribe/abc",
      template: {
        ...getDefaultEmailTemplateContent(),
        customHtmlEnabled: true,
        customHtml: '<p>Hello {{customer_name}}</p><script>alert(1)</script>',
      },
    });

    expect(html).toContain("Hello Jordan");
    // Sanitized again at render time, so a row written by an older build still cannot ship
    // script into an inbox or into the admin preview iframe.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    // A merchant cannot drop these by switching to HTML mode — the renderer owns them.
    expect(html).toContain("https://example.com/unsubscribe/abc");
    expect(html).toContain("Powered by Imagyn Reviews");
    expect(html).toContain("https://example.com/r/sample-token");
  });

  it("uses previewText for the inbox snippet and falls back to the subject when it's empty", async () => {
    const withPreview = await buildReviewRequestEmail({
      ...base,
      template: { ...getDefaultEmailTemplateContent(), previewText: "PREVIEW_MARKER" },
    });
    expect(withPreview.html).toContain("PREVIEW_MARKER");

    const withoutPreview = await buildReviewRequestEmail({
      ...base,
      template: { ...getDefaultEmailTemplateContent(), subject: "SUBJECT_MARKER", previewText: "" },
    });
    expect(withoutPreview.subject).toBe("SUBJECT_MARKER");
  });

  it("clamps a hostile persisted value instead of emitting it into a style attribute", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: {
        ...getDefaultEmailTemplateContent(),
        contentWidth: 999999,
        accentColor: "#fff; background: url(javascript:alert(1))" as string,
      },
    });

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("999999");
  });
});

describe("buildReviewRequestEmail — unresolved variables never reach a customer", () => {
  const base = {
    customerName: "Jordan Avery",
    productName: "Embroidered Lawn Dress",
    storeName: "Grace Store",
    reviewUrl: "https://example.com/r/sample-token",
    customMessage: null,
  };

  it("substitutes the discount code in a reward send", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      discountCode: "THANKS10",
      template: getDefaultEmailTemplateContent("reward"),
    });

    expect(html).toContain("THANKS10");
    expect(html).not.toContain("{{discount_code}}");
  });

  it("strips the token rather than printing it when a reward send has no code", async () => {
    // Should be unreachable — rewards.server.ts only sends after a real code exists — but
    // the degraded output a customer sees must still be clean prose, never "{{discount_code}}".
    const { html, subject } = await buildReviewRequestEmail({
      ...base,
      template: getDefaultEmailTemplateContent("reward"),
    });

    expect(html).not.toContain("{{discount_code}}");
    expect(html).not.toMatch(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/);
    expect(subject).not.toMatch(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/);
  });

  it("strips an unknown token that somehow reached a persisted template", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: { ...getDefaultEmailTemplateContent(), bodyText: "Hi {{frist_name}}, thanks." },
    });

    expect(html).not.toContain("{{frist_name}}");
    expect(html).toContain("Hi");
  });
});

describe("buildReviewRequestEmail — the review link is always reachable", () => {
  const base = {
    customerName: "Jordan Avery",
    productName: "Embroidered Lawn Dress",
    storeName: "Grace Store",
    reviewUrl: "https://example.com/r/sample-token",
    unsubscribeUrl: "https://example.com/u/abc",
    customMessage: null,
  };

  it("custom HTML with no link of its own still carries a working review URL and unsubscribe", async () => {
    const { html } = await buildReviewRequestEmail({
      ...base,
      template: {
        ...getDefaultEmailTemplateContent(),
        customHtmlEnabled: true,
        customHtml: "<p>Just some copy, no link at all.</p>",
      },
    });

    expect(html).toContain("https://example.com/r/sample-token");
    expect(html).toContain("https://example.com/u/abc");
    // ...and it must not refer to a button that custom-HTML mode never rendered.
    expect(html).not.toContain("If the button above");
    expect(html).toContain("Leave your review here");
  });

  it("keeps the button-relative wording in the structured editor, where a button does exist", async () => {
    const { html } = await buildReviewRequestEmail({ ...base, template: getDefaultEmailTemplateContent() });

    expect(html).toContain("If the button above");
    expect(html).not.toContain("Leave your review here");
  });
});
