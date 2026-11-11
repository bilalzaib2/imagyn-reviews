import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_CAROUSEL_SETTINGS, applyCarouselPreset, carouselCssVariables } from "./carouselSettings.shared";

/**
 * The storefront half of the carousel customization.
 *
 * These are source-level assertions on the shipped extension files rather than DOM tests,
 * because the extension is ES5 loaded by Shopify and the thing worth pinning is the contract
 * between it and the admin: that the dashboard values reach it, that a merchant's existing
 * Theme Editor choices still win, and that the stylesheet reads the same variable names the
 * dashboard preview reads. The rendered behaviour itself was verified in a browser against
 * the real files (tools/storefront-harness).
 */
const ROOT = process.cwd();
const EXT = join(ROOT, "extensions", "imagyn-review-widgets");

const carouselJs = readFileSync(join(EXT, "assets", "review-carousel.js"), "utf8");
const carouselCss = readFileSync(join(EXT, "assets", "imagyn-component-carousel.css"), "utf8");
const carouselLiquid = readFileSync(join(EXT, "blocks", "review_carousel.liquid"), "utf8");
const featuredRoute = readFileSync(join(ROOT, "app", "routes", "api.reviews.featured.tsx"), "utf8");

describe("saved settings reach the storefront", () => {
  it("the endpoint sends the normalized settings and the pre-rendered CSS", () => {
    expect(featuredRoute).toMatch(/normalizeCarouselSettings\(widget\.carousel\)/);
    expect(featuredRoute).toMatch(/carouselCss: carouselCssText\(carousel\)/);
  });

  it("the endpoint normalizes rather than trusting what is stored", () => {
    // A row hand-edited in the database, or saved before a control existed, must not reach a
    // storefront unclamped.
    expect(featuredRoute).toContain("normalizeCarouselSettings");
  });

  it("the renderer applies that CSS to its own container, not the document", () => {
    expect(carouselJs).toMatch(/container\.style\.cssText \+= ";" \+ data\.carouselCss/);
  });

  it("the renderer merges the app settings and applies the structural ones", () => {
    expect(carouselJs).toMatch(/mergeCarouselSettings\(readExplicitSettings\(container\), data\.carousel\)/);
    expect(carouselJs).toMatch(/applyStructuralSettings\(container, settings\)/);
  });
});

describe("existing Theme Editor configurations still win", () => {
  it("the block emits an overlapping setting only when it differs from its default", () => {
    // If these were emitted unconditionally, every block would always override the dashboard
    // and the new controls would appear to do nothing.
    for (const setting of [
      "show_rating",
      "show_date",
      "show_name",
      "show_images",
      "show_video",
      "show_product",
      "show_arrows",
      "show_dots",
      "autoplay",
    ]) {
      expect(carouselLiquid, `${setting} must be conditional`).toMatch(
        new RegExp(`\\{%\\s*if block\\.settings\\.${setting} !=`),
      );
    }
  });

  it("reads only attributes that are actually present when deciding precedence", () => {
    expect(carouselJs).toMatch(/function readExplicitSettings\(container\)/);
    expect(carouselJs).toMatch(/if \(value === null\) return;/);
  });

  it("keeps the defaulting reader too, so an older response still renders", () => {
    // readSettings fills in defaults; it is what runs when data.carousel is absent.
    expect(carouselJs).toMatch(/function readSettings\(container\)/);
    expect(carouselJs).toMatch(/if \(data\.carousel\)/);
  });

  it("a theme value overrides the app value, and app fills the rest", () => {
    // Mirrors mergeCarouselSettings' own precedence, asserted on its source shape.
    const merge = carouselJs.slice(carouselJs.indexOf("function mergeCarouselSettings"));
    const appLoop = merge.indexOf("for (key in appSettings)");
    const themeLoop = merge.indexOf("for (key in themeSettings)");

    expect(appLoop).toBeGreaterThan(-1);
    expect(themeLoop).toBeGreaterThan(appLoop); // theme is copied second, so it wins
  });
});

describe("turning images off removes them rather than hiding them", () => {
  it("suppresses the media flags so no media markup is emitted", () => {
    expect(carouselJs).toMatch(/imageVisibility === "never"/);
    expect(carouselJs).toMatch(/merged\.showImages = false;/);
    expect(carouselJs).toMatch(/merged\.showVideo = false;/);
  });

  it("the stylesheet also hides it, so a cached response cannot flash media", () => {
    expect(carouselCss).toMatch(/\[data-imagyn-image-visibility="never"\][^{]*\{[^}]*display: none/s);
  });
});

describe("the stylesheet consumes the same variables the dashboard preview does", () => {
  const variableNames = Object.keys(carouselCssVariables(DEFAULT_CAROUSEL_SETTINGS));

  // The ones that carry a merchant's visible choices. If the stylesheet stops reading one, the
  // control silently stops working, which is precisely the failure this guards.
  it.each([
    "--imagyn-carousel-card-radius",
    "--imagyn-carousel-card-padding",
    "--imagyn-carousel-card-shadow",
    "--imagyn-carousel-card-bg",
    "--imagyn-carousel-image-radius",
    "--imagyn-carousel-image-fit",
    "--imagyn-carousel-image-ratio",
    "--imagyn-carousel-title-size",
    "--imagyn-carousel-body-size",
    "--imagyn-carousel-text-align",
    "--imagyn-carousel-star-color",
    "--imagyn-carousel-max-lines",
    "--imagyn-carousel-gap",
  ])("%s is produced by the shared module and read by the stylesheet", (name) => {
    expect(variableNames).toContain(name);
    expect(carouselCss).toContain(`var(${name}`);
  });

  it("every BASE clamp rule reads the line-count variable, so none silently wins", () => {
    // A hardcoded -webkit-line-clamp at higher specificity made "maximum visible lines" do
    // nothing until each base rule was parameterized; this keeps that from coming back.
    //
    // The [data-review-length] variants are deliberately excluded: those are the Theme
    // Editor's own "review length" setting, and a literal value there is the whole point —
    // a merchant who explicitly picked Short/Long in the Theme Editor should still win, which
    // is the same precedence rule the rest of this file asserts.
    const baseRules = carouselCss
      .split("}")
      .filter((rule) => rule.includes("-webkit-line-clamp") && !rule.includes("[data-review-length="));

    expect(baseRules.length).toBeGreaterThan(0);
    for (const rule of baseRules) {
      const value = /-webkit-line-clamp:\s*([^;]+);/.exec(rule)?.[1]?.trim() ?? "";
      expect(value === "unset" || value.includes("--imagyn-carousel-max-lines"), `unparameterized clamp: ${value}`).toBe(true);
    }
  });

  it("the Theme Editor's own review-length variants are still present and literal", () => {
    expect(carouselCss).toMatch(/\[data-review-length="small"\]/);
    expect(carouselCss).toMatch(/\[data-review-length="large"\]/);
  });

  it("reduced motion is enforced regardless of the configured transition", () => {
    expect(carouselCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe("structural settings travel as data attributes", () => {
  it.each([
    "data-imagyn-image-position",
    "data-imagyn-image-visibility",
    "data-imagyn-equal-height",
    "data-imagyn-arrow-position",
    "data-imagyn-dot-style",
    "data-imagyn-text-display",
  ])("%s is set by the renderer and used by the stylesheet", (attr) => {
    expect(carouselJs).toContain(attr);
    expect(carouselCss).toContain(`[${attr}=`);
  });

  // "above" is the card's natural column order and needs no rule; the other four each change
  // the layout and must have one.
  it.each(["below", "left", "right", "background"])("image position %s has a rule", (position) => {
    expect(carouselCss).toContain(`[data-imagyn-image-position="${position}"]`);
  });

  it("'above' is the default the others deviate from", () => {
    expect(DEFAULT_CAROUSEL_SETTINGS.imagePosition).toBe("above");
  });

  it("the background position keeps a scrim, so overlaid text stays readable", () => {
    const rule = carouselCss.slice(carouselCss.indexOf('[data-imagyn-image-position="background"] .imagyn-carousel__content'));
    expect(rule.slice(0, 400)).toMatch(/linear-gradient/);
  });
});

describe("presets reach the storefront as real differences", () => {
  it.each(["minimal", "editorial", "modern", "image-focused", "compact"])(
    "%s produces a different CSS payload from the defaults",
    (id) => {
      const base = carouselCssVariables(DEFAULT_CAROUSEL_SETTINGS);
      const preset = carouselCssVariables(applyCarouselPreset(DEFAULT_CAROUSEL_SETTINGS, id));

      expect(JSON.stringify(preset)).not.toEqual(JSON.stringify(base));
    },
  );

  it("compact genuinely turns images off, which is its defining choice", () => {
    expect(applyCarouselPreset(DEFAULT_CAROUSEL_SETTINGS, "compact").imageVisibility).toBe("never");
  });

  it("image-focused genuinely enlarges the image", () => {
    const applied = applyCarouselPreset(DEFAULT_CAROUSEL_SETTINGS, "image-focused");
    expect(applied.imageSize).toBe("large");
    expect(carouselCssVariables(applied)["--imagyn-carousel-image-max-height"]).toBe("320px");
  });
});

describe("the customization screen is actually reachable", () => {
  const routes = readdirSync(join(ROOT, "app", "routes"));

  // Caught in production, not by the preview harness: the harness renders route components
  // directly, so a route that never matches still looks fine there. Nesting this screen under
  // app.widgets.tsx — which renders no <Outlet/> — made /app/widgets/carousel silently render
  // the Widgets list instead, even on a direct hard refresh.
  it("opts out of the widgets layout, which has no Outlet", () => {
    expect(routes).toContain("app.widgets_.carousel.tsx");
    expect(routes).not.toContain("app.widgets.carousel.tsx");
  });

  it("app.widgets.tsx still renders no Outlet, which is why the escape is needed", () => {
    const widgets = readFileSync(join(ROOT, "app", "routes", "app.widgets.tsx"), "utf8");
    expect(widgets).not.toMatch(/<Outlet\s*\/>/);
  });

  it("the Widgets dashboard links to the screen", () => {
    const widgets = readFileSync(join(ROOT, "app", "routes", "app.widgets.tsx"), "utf8");
    expect(widgets).toContain("/app/widgets/carousel");
    expect(widgets).toMatch(/card\.key === "review-carousel"/);
  });
});
