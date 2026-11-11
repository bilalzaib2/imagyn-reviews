import { describe, expect, it } from "vitest";

import {
  CAROUSEL_LIMITS,
  CAROUSEL_PRESETS,
  DEFAULT_CAROUSEL_SETTINGS,
  applyCarouselPreset,
  carouselCssText,
  carouselCssVariables,
  getCarouselPreset,
  normalizeCarouselSettings,
  type CarouselSettings,
} from "./carouselSettings.shared";

const defaults = DEFAULT_CAROUSEL_SETTINGS;

describe("normalizeCarouselSettings accepts anything and returns something valid", () => {
  it.each([null, undefined, 0, "", "nonsense", [], { nope: true }])("%p falls back to defaults", (input) => {
    expect(normalizeCarouselSettings(input)).toEqual(defaults);
  });

  it("keeps values a merchant actually chose", () => {
    const result = normalizeCarouselSettings({ ...defaults, cardRadius: 20, cardsDesktop: 4, showDate: false });

    expect(result.cardRadius).toBe(20);
    expect(result.cardsDesktop).toBe(4);
    expect(result.showDate).toBe(false);
  });

  // The whole point of storing a partial: adding a control must not invalidate configurations
  // merchants already saved.
  it("fills in controls that did not exist when the settings were saved", () => {
    const legacy = { cardsDesktop: 2, showRating: false };

    const result = normalizeCarouselSettings(legacy);

    expect(result.cardsDesktop).toBe(2);
    expect(result.showRating).toBe(false);
    expect(result.imagePosition).toBe(defaults.imagePosition);
    expect(result.cardShadow).toBe(defaults.cardShadow);
  });
});

describe("numeric settings are clamped to safe bounds", () => {
  const numericCases: Array<[keyof CarouselSettings, keyof typeof CAROUSEL_LIMITS]> = [
    ["cardRadius", "cardRadius"],
    ["cardPadding", "cardPadding"],
    ["cardGap", "cardGap"],
    ["cardsDesktop", "cardsDesktop"],
    ["cardsTablet", "cardsTablet"],
    ["cardsMobile", "cardsMobile"],
    ["bodyFontSize", "bodyFontSize"],
    ["titleFontSize", "titleFontSize"],
    ["lineHeight", "lineHeight"],
    ["maxLines", "maxLines"],
    ["autoplaySpeed", "autoplaySpeed"],
    ["animationMs", "animationMs"],
    ["imageCustomHeight", "imageCustomHeight"],
  ];

  it.each(numericCases)("%s is clamped at both ends", (field, limitKey) => {
    const { min, max } = CAROUSEL_LIMITS[limitKey];

    expect(normalizeCarouselSettings({ [field]: -9999 })[field]).toBe(min);
    expect(normalizeCarouselSettings({ [field]: 9999 })[field]).toBe(max);
  });

  it.each(numericCases)("%s rejects NaN rather than storing it", (field) => {
    expect(Number.isFinite(normalizeCarouselSettings({ [field]: "abc" })[field] as number)).toBe(true);
  });

  it("keeps card counts whole — half a card is not a layout", () => {
    expect(normalizeCarouselSettings({ cardsDesktop: 2.7 }).cardsDesktop).toBe(3);
  });
});

describe("colours are restricted to hex, because they reach a style attribute", () => {
  it.each(["#fff", "#FFFFFF", "#5c9754"])("%s is accepted", (value) => {
    expect(normalizeCarouselSettings({ cardBackground: value }).cardBackground).toBe(value.toLowerCase());
  });

  // Each of these would otherwise become CSS inside the storefront's style attribute.
  it.each([
    "red; background: url(https://evil.example/x)",
    "expression(alert(1))",
    "url(javascript:alert(1))",
    "#fff;}body{display:none",
    "var(--anything)",
    "rgb(0,0,0)",
    "",
  ])("%p is rejected and falls back to the default", (value) => {
    expect(normalizeCarouselSettings({ cardBackground: value }).cardBackground).toBe(defaults.cardBackground);
  });

  it("no generated CSS value can escape its declaration", () => {
    const hostile = normalizeCarouselSettings({
      cardBackground: "#fff;}body{display:none",
      starColor: "red;",
      textColor: "url(javascript:alert(1))",
      imageBorderColor: "</style><script>",
    });

    const css = carouselCssText(hostile);

    expect(css).not.toContain("}");
    expect(css).not.toContain("<");
    expect(css).not.toContain("javascript:");
    expect(css).not.toContain("url(");
  });
});

describe("enumerated settings reject values outside their option list", () => {
  it.each([
    ["imagePosition", "diagonal"],
    ["imageFit", "stretch"],
    ["cardShadow", "enormous"],
    ["textAlign", "justify"],
    ["fontFamily", "comic-sans"],
    ["cardBorderStyle", "groove"],
  ] as const)("%s rejects %p", (field, value) => {
    expect(normalizeCarouselSettings({ [field]: value })[field]).toBe(defaults[field]);
  });
});

describe("the five presets", () => {
  it("there are exactly five, with the expected identities", () => {
    expect(CAROUSEL_PRESETS.map((p) => p.id)).toEqual([
      "minimal",
      "editorial",
      "modern",
      "image-focused",
      "compact",
    ]);
  });

  it.each(CAROUSEL_PRESETS.map((p) => p.id))("%s produces a fully valid settings object", (id) => {
    const applied = applyCarouselPreset(defaults, id);

    expect(applied).toEqual(normalizeCarouselSettings(applied));
    expect(Object.keys(applied).sort()).toEqual(Object.keys(defaults).sort());
  });

  it.each(CAROUSEL_PRESETS.map((p) => p.id))("%s actually changes something", (id) => {
    expect(applyCarouselPreset(defaults, id)).not.toEqual(defaults);
  });

  it("a preset is a starting point — any setting stays editable afterwards", () => {
    const afterPreset = applyCarouselPreset(defaults, "compact");
    const edited = normalizeCarouselSettings({ ...afterPreset, cardRadius: 28, showDate: true });

    expect(edited.cardRadius).toBe(28);
    expect(edited.showDate).toBe(true);
    // and the rest of the preset survives the edit
    expect(edited.cardsDesktop).toBe(afterPreset.cardsDesktop);
  });

  it("presets do not discard settings they say nothing about", () => {
    const custom = normalizeCarouselSettings({ ...defaults, starColor: "#5c9754" });

    expect(applyCarouselPreset(custom, "minimal").starColor).toBe("#5c9754");
  });

  it("an unknown preset id leaves settings untouched rather than resetting them", () => {
    const custom = normalizeCarouselSettings({ ...defaults, cardRadius: 30 });

    expect(applyCarouselPreset(custom, "does-not-exist")).toEqual(custom);
    expect(getCarouselPreset("does-not-exist")).toBeUndefined();
  });
});

describe("CSS variables are the shared contract between preview and storefront", () => {
  it("every variable is namespaced to the widget so it cannot collide with a theme", () => {
    for (const name of Object.keys(carouselCssVariables(defaults))) {
      expect(name.startsWith("--imagyn-carousel-")).toBe(true);
    }
  });

  it("maps the settings a merchant is most likely to change", () => {
    const vars = carouselCssVariables(
      normalizeCarouselSettings({ ...defaults, cardRadius: 20, cardGap: 24, cardsDesktop: 4, textAlign: "center" }),
    );

    expect(vars["--imagyn-carousel-card-radius"]).toBe("20px");
    expect(vars["--imagyn-carousel-gap"]).toBe("24px");
    expect(vars["--imagyn-carousel-cards-desktop"]).toBe("4");
    expect(vars["--imagyn-carousel-text-align"]).toBe("center");
  });

  it("aspect ratios resolve to real CSS ratios", () => {
    const ratio = (value: string) =>
      carouselCssVariables(normalizeCarouselSettings({ ...defaults, imageAspectRatio: value }))[
        "--imagyn-carousel-image-ratio"
      ];

    expect(ratio("square")).toBe("1 / 1");
    expect(ratio("portrait")).toBe("4 / 5");
    expect(ratio("landscape")).toBe("16 / 9");
    expect(ratio("original")).toBe("auto");
  });

  it("object-fit passes through for both options", () => {
    for (const fit of ["cover", "contain"]) {
      expect(
        carouselCssVariables(normalizeCarouselSettings({ ...defaults, imageFit: fit }))["--imagyn-carousel-image-fit"],
      ).toBe(fit);
    }
  });

  it("image size presets and a custom height both produce a max height", () => {
    const height = (overrides: Partial<CarouselSettings>) =>
      carouselCssVariables(normalizeCarouselSettings({ ...defaults, ...overrides }))[
        "--imagyn-carousel-image-max-height"
      ];

    expect(height({ imageSize: "small" })).toBe("140px");
    expect(height({ imageSize: "large" })).toBe("320px");
    expect(height({ imageSize: "custom", imageCustomHeight: 275 })).toBe("275px");
  });

  it("'theme' font inherits rather than imposing a typeface", () => {
    expect(carouselCssVariables(defaults)["--imagyn-carousel-font-family"]).toBe("inherit");
  });

  it("border style none also zeroes the width, so a stray width cannot draw a border", () => {
    const vars = carouselCssVariables(
      normalizeCarouselSettings({ ...defaults, cardBorderStyle: "none", cardBorderWidth: 6 }),
    );

    expect(vars["--imagyn-carousel-card-border-width"]).toBe("0px");
    expect(vars["--imagyn-carousel-card-border-style"]).toBe("none");
  });

  it("full text display removes the line clamp instead of setting a huge number", () => {
    expect(
      carouselCssVariables(normalizeCarouselSettings({ ...defaults, textDisplay: "full" }))[
        "--imagyn-carousel-max-lines"
      ],
    ).toBe("unset");
  });
});
