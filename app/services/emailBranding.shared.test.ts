// Shared Email Branding.
//
// The acceptance criterion for the whole feature is one sentence: upload or replace the
// logo once, and every applicable template uses it without editing each one. These tests
// hold that line at the resolver, and emailBranding.render.test.ts holds it at the real
// renderer.
import { describe, expect, it } from "vitest";
import { logoForTheme, resolveEmailLogo } from "./emailBranding.shared";
import { getDefaultEmailTemplateContent, normalizeEmailTemplateContent } from "./email.shared";

const SHARED = { emailLogoUrl: "https://cdn.example.com/shared.png", emailLogoDarkUrl: null };

function content(overrides: Partial<ReturnType<typeof getDefaultEmailTemplateContent>> = {}) {
  return { ...getDefaultEmailTemplateContent(), ...overrides };
}

describe("inheritance", () => {
  it("uses the shared logo by default", () => {
    const resolved = resolveEmailLogo(content(), SHARED);

    expect(resolved.logoUrl).toBe("https://cdn.example.com/shared.png");
    expect(resolved.inheritsShared).toBe(true);
  });

  it("one shared change reaches every template at once", () => {
    const templates = ["review_request", "reminder_1", "reminder_final", "reward"] as const;
    const before = templates.map((type) => resolveEmailLogo(getDefaultEmailTemplateContent(type), SHARED));
    expect(before.every((r) => r.logoUrl === "https://cdn.example.com/shared.png")).toBe(true);

    // Replace the shared logo once — no template is edited.
    const after = templates.map((type) =>
      resolveEmailLogo(getDefaultEmailTemplateContent(type), {
        emailLogoUrl: "https://cdn.example.com/new.png",
        emailLogoDarkUrl: null,
      }),
    );
    expect(after.every((r) => r.logoUrl === "https://cdn.example.com/new.png")).toBe(true);
  });

  it("removing the shared logo removes it everywhere, leaving the text header", () => {
    const resolved = resolveEmailLogo(content(), { emailLogoUrl: null, emailLogoDarkUrl: null });

    expect(resolved.logoUrl).toBeNull();
    expect(resolved.inheritsShared).toBe(true);
  });

  it("never leaves a stale per-template URL in play while inheriting", () => {
    // A template that still carries an old URL but is set to inherit must show the shared
    // one — the stale value must not win.
    const resolved = resolveEmailLogo(
      content({ logoUrl: "https://cdn.example.com/STALE.png", logoSource: "shared" }),
      SHARED,
    );

    expect(resolved.logoUrl).toBe("https://cdn.example.com/shared.png");
  });
});

describe("explicit override", () => {
  it("uses the template's own asset", () => {
    const resolved = resolveEmailLogo(
      content({ logoUrl: "https://cdn.example.com/own.png", logoSource: "custom" }),
      SHARED,
    );

    expect(resolved.logoUrl).toBe("https://cdn.example.com/own.png");
    expect(resolved.inheritsShared).toBe(false);
  });

  it("an override with no asset means no logo, not a silent fall back to shared", () => {
    // "Not the shared logo" must not be reinterpreted as "the shared logo".
    const resolved = resolveEmailLogo(content({ logoUrl: null, logoSource: "custom" }), SHARED);

    expect(resolved.logoUrl).toBeNull();
  });

  it("a shared change does not disturb an overriding template", () => {
    const overriding = content({ logoUrl: "https://cdn.example.com/own.png", logoSource: "custom" });

    expect(resolveEmailLogo(overriding, SHARED).logoUrl).toBe("https://cdn.example.com/own.png");
    expect(
      resolveEmailLogo(overriding, { emailLogoUrl: "https://cdn.example.com/new.png", emailLogoDarkUrl: null })
        .logoUrl,
    ).toBe("https://cdn.example.com/own.png");
  });
});

describe("light and dark variants", () => {
  it("uses the dark asset on the dark palette", () => {
    const resolved = resolveEmailLogo(content(), {
      emailLogoUrl: "https://cdn.example.com/light.png",
      emailLogoDarkUrl: "https://cdn.example.com/dark.png",
    });

    expect(logoForTheme(resolved, "dark")).toBe("https://cdn.example.com/dark.png");
    expect(logoForTheme(resolved, "light")).toBe("https://cdn.example.com/light.png");
  });

  it("falls back to the light asset when no dark variant exists", () => {
    const resolved = resolveEmailLogo(content(), SHARED);

    expect(logoForTheme(resolved, "dark")).toBe("https://cdn.example.com/shared.png");
  });

  it("returns null for both palettes when nothing is configured", () => {
    const resolved = resolveEmailLogo(content(), null);

    expect(logoForTheme(resolved, "light")).toBeNull();
    expect(logoForTheme(resolved, "dark")).toBeNull();
  });
});

// The migration guarantee. Existing merchants have a logo inside each template's JSON and
// no logoSource at all; the rollout must not blank or replace those assets.
describe("existing merchant templates", () => {
  it("keeps an existing per-template logo by inferring an override", () => {
    const legacy = normalizeEmailTemplateContent({
      ...getDefaultEmailTemplateContent(),
      logoUrl: "https://cdn.example.com/merchant-uploaded.png",
      logoSource: undefined as never,
    });

    expect(legacy.logoSource).toBe("custom");
    expect(resolveEmailLogo(legacy, SHARED).logoUrl).toBe("https://cdn.example.com/merchant-uploaded.png");
  });

  it("starts a template with no logo on the shared source", () => {
    const legacy = normalizeEmailTemplateContent({
      ...getDefaultEmailTemplateContent(),
      logoUrl: null,
      logoSource: undefined as never,
    });

    expect(legacy.logoSource).toBe("shared");
  });

  it("respects an explicitly stored 'shared' even when a logo is still present", () => {
    // A merchant who switched back to shared must stay shared, regardless of the leftover
    // URL — otherwise the inference would silently re-override them on every read.
    const switched = normalizeEmailTemplateContent({
      ...getDefaultEmailTemplateContent(),
      logoUrl: "https://cdn.example.com/leftover.png",
      logoSource: "shared",
    });

    expect(switched.logoSource).toBe("shared");
    expect(resolveEmailLogo(switched, SHARED).logoUrl).toBe("https://cdn.example.com/shared.png");
  });

  it("survives a round trip through normalize", () => {
    const once = normalizeEmailTemplateContent(content({ logoSource: "custom" }));
    const twice = normalizeEmailTemplateContent(once);

    expect(twice.logoSource).toBe("custom");
  });
});

// ---------------------------------------------------------------------------------------------
// Tier 3: the merchant's Shopify brand logo.
//
// The gap this closed: a store that had never opened Email Studio had no logo at all, so its
// review requests went out with a text-only header and looked generic next to a competitor's.
// Shopify already holds a brand logo for most stores, so the branded default was available for
// free and simply was not being read. See shopBrandLogo.server.ts.
//
// The rule being pinned here is that it is a FALLBACK and never an override — a merchant's own
// choice, including the choice to have no logo on a specific template, always wins.
// ---------------------------------------------------------------------------------------------

const SHOP_LOGO = "https://cdn.shopify.com/brand/shop-logo.png";

describe("Shopify brand logo fallback", () => {
  it("is used when the merchant has configured no logo of their own", () => {
    const resolved = resolveEmailLogo(content(), {
      emailLogoUrl: null,
      emailLogoDarkUrl: null,
      shopBrandLogoUrl: SHOP_LOGO,
    });

    expect(resolved.logoUrl).toBe(SHOP_LOGO);
    expect(resolved.inheritsShared).toBe(true);
  });

  it("never overrides a logo the merchant uploaded in Email Studio", () => {
    const resolved = resolveEmailLogo(content(), { ...SHARED, shopBrandLogoUrl: SHOP_LOGO });

    expect(resolved.logoUrl).toBe("https://cdn.example.com/shared.png");
  });

  // An explicit per-template override saying "not the shared logo" must not be reinterpreted
  // as "then use Shopify's" — that is the same rule the custom-override branch already holds,
  // extended to the new tier.
  it("never resurrects a logo for a template that explicitly overrides with none", () => {
    const resolved = resolveEmailLogo(
      content({ logoSource: "custom", logoUrl: null, logoDarkUrl: null }),
      { emailLogoUrl: null, emailLogoDarkUrl: null, shopBrandLogoUrl: SHOP_LOGO },
    );

    expect(resolved.logoUrl).toBeNull();
    expect(resolved.inheritsShared).toBe(false);
  });

  it("yields no logo when the store has nothing configured anywhere", () => {
    const resolved = resolveEmailLogo(content(), {
      emailLogoUrl: null,
      emailLogoDarkUrl: null,
      shopBrandLogoUrl: null,
    });

    expect(resolved.logoUrl).toBeNull();
  });

  // Every pre-existing caller passes a branding object without the new field. Those must keep
  // behaving exactly as before rather than throwing or resolving something unexpected.
  it("is backwards compatible with a branding object that omits the field entirely", () => {
    const resolved = resolveEmailLogo(content(), { emailLogoUrl: null, emailLogoDarkUrl: null });

    expect(resolved.logoUrl).toBeNull();
    expect(resolved.inheritsShared).toBe(true);
  });

  it("does not become the dark-palette asset on its own", () => {
    const resolved = resolveEmailLogo(content(), {
      emailLogoUrl: null,
      emailLogoDarkUrl: null,
      shopBrandLogoUrl: SHOP_LOGO,
    });

    // logoDarkUrl stays null; the renderer's own "dark falls back to light" rule covers it,
    // which is correct — a single shop logo has no dark variant to promise.
    expect(resolved.logoDarkUrl).toBeNull();
    expect(logoForTheme(resolved, "dark")).toBe(SHOP_LOGO);
  });
});
