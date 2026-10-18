// Shared Email Branding, verified through the PRODUCTION renderer.
//
// emailBranding.shared.test.ts proves the resolution rules. This file proves the rules
// actually reach the HTML a customer receives, for every template type, using the same
// buildReviewRequestEmail that dispatchRequestEmail, dispatchReminderEmail, the reward send
// and the Email Studio preview all call. A separate preview implementation drifting from
// production rendering is the exact failure mode this guards.
import { describe, expect, it } from "vitest";
import { buildReviewRequestEmail } from "./templates.server";
import { EMAIL_TEMPLATE_TYPES, getDefaultEmailTemplateContent } from "../email.shared";

const SHARED_LOGO = "https://cdn.example.com/shared-brand.png";
const DARK_LOGO = "https://cdn.example.com/shared-brand-dark.png";

function dataFor(type: (typeof EMAIL_TEMPLATE_TYPES)[number], overrides: Record<string, unknown> = {}) {
  return {
    customerName: "Jordan Avery",
    productName: "Merino Crew",
    storeName: "Coastal Threads",
    reviewUrl: "https://example.com/r/sample-token",
    customMessage: null,
    template: getDefaultEmailTemplateContent(type),
    discountCode: type === "reward" ? "SAMPLE-CODE" : undefined,
    ...overrides,
  };
}

describe("every template inherits the shared logo", () => {
  for (const type of EMAIL_TEMPLATE_TYPES) {
    it(`${type} renders the shared logo in the real HTML`, async () => {
      const { html } = await buildReviewRequestEmail({
        ...dataFor(type),
        branding: { emailLogoUrl: SHARED_LOGO, emailLogoDarkUrl: null },
      } as never);

      expect(html).toContain(SHARED_LOGO);
    });
  }

  it("replacing the shared logo once changes every template's HTML", async () => {
    const replaced = "https://cdn.example.com/replaced.png";

    for (const type of EMAIL_TEMPLATE_TYPES) {
      const { html } = await buildReviewRequestEmail({
        ...dataFor(type),
        branding: { emailLogoUrl: replaced, emailLogoDarkUrl: null },
      } as never);

      expect(html).toContain(replaced);
      expect(html).not.toContain(SHARED_LOGO);
    }
  });

  it("removing the shared logo removes the image from every template", async () => {
    for (const type of EMAIL_TEMPLATE_TYPES) {
      const { html } = await buildReviewRequestEmail({
        ...dataFor(type),
        branding: { emailLogoUrl: null, emailLogoDarkUrl: null },
      } as never);

      expect(html).not.toContain(SHARED_LOGO);
      // The store name still identifies the sender — a clean text header, not a blank space.
      expect(html).toContain("Coastal Threads");
    }
  });
});

describe("no stale per-template URLs", () => {
  it("a template still carrying an old URL but set to inherit renders the shared one", async () => {
    const stale = "https://cdn.example.com/STALE-OLD-LOGO.png";
    const { html } = await buildReviewRequestEmail({
      ...dataFor("reminder_final", {
        template: { ...getDefaultEmailTemplateContent("reminder_final"), logoUrl: stale, logoSource: "shared" },
      }),
      branding: { emailLogoUrl: SHARED_LOGO, emailLogoDarkUrl: null },
    } as never);

    expect(html).toContain(SHARED_LOGO);
    expect(html).not.toContain(stale);
  });
});

describe("explicit per-template override", () => {
  it("renders the template's own asset and ignores the shared one", async () => {
    const own = "https://cdn.example.com/just-this-email.png";
    const { html } = await buildReviewRequestEmail({
      ...dataFor("reward", {
        template: { ...getDefaultEmailTemplateContent("reward"), logoUrl: own, logoSource: "custom" },
      }),
      branding: { emailLogoUrl: SHARED_LOGO, emailLogoDarkUrl: null },
    } as never);

    expect(html).toContain(own);
    expect(html).not.toContain(SHARED_LOGO);
  });
});

describe("light and dark variants in real HTML", () => {
  it("uses the dark asset when the template renders on the dark theme", async () => {
    const { html } = await buildReviewRequestEmail({
      ...dataFor("review_request", {
        template: { ...getDefaultEmailTemplateContent("review_request"), theme: "dark" },
      }),
      branding: { emailLogoUrl: SHARED_LOGO, emailLogoDarkUrl: DARK_LOGO },
    } as never);

    expect(html).toContain(DARK_LOGO);
    expect(html).not.toContain(SHARED_LOGO);
  });

  it("reuses the light asset on dark when no dark variant is configured", async () => {
    const { html } = await buildReviewRequestEmail({
      ...dataFor("review_request", {
        template: { ...getDefaultEmailTemplateContent("review_request"), theme: "dark" },
      }),
      branding: { emailLogoUrl: SHARED_LOGO, emailLogoDarkUrl: null },
    } as never);

    expect(html).toContain(SHARED_LOGO);
  });
});

describe("no branding supplied", () => {
  it("renders a text header rather than a broken image", async () => {
    const { html } = await buildReviewRequestEmail(dataFor("review_request") as never);

    expect(html).not.toContain("cdn.example.com");
    expect(html).toContain("Coastal Threads");
  });
});
