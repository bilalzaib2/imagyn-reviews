/*
 * Imagyn Reviews — Appearance System bridge.
 *
 * The one place that turns a store's resolved AppearanceTokens (app/services/
 * appearance.shared.ts) into real --imagyn-* CSS custom properties. Loaded once, before
 * each widget's own script tag (see the three blocks/*.liquid files), and applied at
 * document.documentElement (:root) — not a per-widget root — so every current widget
 * (Reviews, Rating Badge, Collection Badges) and every future one inherits it for free,
 * with zero widget-specific plumbing. Scale/density/radius math lives here, once, rather
 * than being duplicated per widget script.
 *
 * Two current widgets need one extra step beyond this file: their own CSS has a
 * hardcoded fallback that doesn't chain through --imagyn-color-star (rating-badge.css's
 * .imagyn-rating-badge__stars, collection-rating-badges' own override variables), so
 * reviews-widget.js/rating-badge.js/collection-rating-badges.js each also set their own
 * legacy override variable from the same resolved tokens, immediately after calling
 * apply() here — see the "appearance" section of each of those files.
 *
 * FUTURE EXTENSION POINT (not implemented): true instant live-preview-to-a-real-tab would
 * have this file check a short-lived `?imagyn_preview=<token>` query param before falling
 * back to the fetched/saved value, paired with an in-memory SSE/long-poll endpoint the
 * admin's draft-edit form pushes into, keyed by that token — no DB writes until Save.
 *
 * Load imagyn-tokens.css before this file (this only overrides its custom properties,
 * never redefines the selector rules that consume them).
 */
(function () {
  var BASE_FONT_SIZE = { xs: 12, sm: 13, base: 15, md: 17, lg: 20, xl: 26, "2xl": 34 };
  var BASE_SPACE_EM = { "3xs": 0.2, "2xs": 0.3, xs: 0.4, sm: 0.6, md: 1, lg: 1.5, xl: 2.5 };
  var BASE_SPACE_PX = { xs: 8, sm: 12, md: 16, lg: 24, xl: 40 };

  var DENSITY_MULTIPLIER = { compact: 0.75, balanced: 1, spacious: 1.35 };
  var CARD_SHADOW = {
    none: "none",
    subtle: "0 1px 2px rgba(0, 0, 0, 0.05)",
    medium: "0 2px 8px rgba(0, 0, 0, 0.06)",
  };
  var BUTTON_STYLE = {
    // A solid button's background must be a real, independently-resolving color, not
    // currentColor/--imagyn-color-text — this same element's `color` is set to a literal
    // white just below, and `background: currentColor` would resolve against THIS
    // element's own (white) color, not an ambient/inherited one, producing an invisible
    // white-on-white button. Outline/ghost don't have this problem: their background stays
    // literally "transparent", so their currentColor-based text/border can safely refer to
    // the ambient inherited color instead.
    solid: {
      background: "#111111",
      color: "var(--imagyn-color-surface, #ffffff)",
      borderColor: "transparent",
    },
    outline: {
      background: "transparent",
      color: "var(--imagyn-color-text, #111111)",
      borderColor: "var(--imagyn-color-text, #111111)",
    },
    ghost: {
      background: "transparent",
      color: "var(--imagyn-color-text, #111111)",
      borderColor: "transparent",
    },
  };

  function setVar(style, name, value) {
    if (value === null || value === undefined) return;
    style.setProperty(name, value);
  }

  function applyTypography(style, typography) {
    if (!typography) return;
    var scale = typeof typography.scale === "number" ? typography.scale : 1;
    for (var key in BASE_FONT_SIZE) {
      if (Object.prototype.hasOwnProperty.call(BASE_FONT_SIZE, key)) {
        setVar(style, "--imagyn-font-size-" + key, Math.round(BASE_FONT_SIZE[key] * scale) + "px");
      }
    }
    if (typography.letterSpacing) {
      setVar(style, "--imagyn-letter-spacing-tight", typography.letterSpacing === "normal" ? "0.02em" : "0.01em");
    }
    // Reserved seam for Brand Studio's future custom-font picker (appearance.shared.ts) —
    // unset/null leaves imagyn-tokens.css's own system-font stack untouched.
    if (typography.fontFamily) {
      setVar(style, "--imagyn-font-family", typography.fontFamily);
    }
  }

  function applyColors(style, colors) {
    if (!colors) return;
    setVar(style, "--imagyn-color-star", colors.starColor);
    setVar(style, "--imagyn-color-star-empty", colors.starEmptyColor);
    setVar(style, "--imagyn-color-border", colors.borderColor);
    setVar(style, "--imagyn-color-surface", colors.surfaceColor);
    if (colors.textColor) setVar(style, "--imagyn-color-text", colors.textColor);
  }

  function applySpacing(style, spacing) {
    if (!spacing) return;
    var multiplier = DENSITY_MULTIPLIER[spacing.density] || 1;
    for (var emKey in BASE_SPACE_EM) {
      if (Object.prototype.hasOwnProperty.call(BASE_SPACE_EM, emKey)) {
        setVar(style, "--imagyn-space-" + emKey, (BASE_SPACE_EM[emKey] * multiplier).toFixed(2) + "em");
      }
    }
    for (var pxKey in BASE_SPACE_PX) {
      if (Object.prototype.hasOwnProperty.call(BASE_SPACE_PX, pxKey)) {
        setVar(style, "--imagyn-space-px-" + pxKey, Math.round(BASE_SPACE_PX[pxKey] * multiplier) + "px");
      }
    }
  }

  function applyCorners(style, corners) {
    if (!corners || typeof corners.radius !== "number") return;
    // One slider drives all three: `radius` IS --imagyn-radius-md; sm/lg derive
    // proportionally (0.5x / 1.5x, the same ratio BASE_RADIUS used statically) so every
    // rounded surface stays in scale together. --imagyn-radius-full (pills) is deliberately
    // never scaled (STOREFRONT_DESIGN_SYSTEM.md §6 — pills stay 999px regardless).
    setVar(style, "--imagyn-radius-sm", Math.round(corners.radius * 0.5) + "px");
    setVar(style, "--imagyn-radius-md", Math.round(corners.radius) + "px");
    setVar(style, "--imagyn-radius-lg", Math.round(corners.radius * 1.5) + "px");
  }

  function applyBorders(style, borders) {
    if (!borders || typeof borders.width !== "number") return;
    setVar(style, "--imagyn-border-width", borders.width + "px");
  }

  function applyReviewCards(style, reviewCards, cards, borders) {
    if (!reviewCards) return;
    var borderWidth = borders && typeof borders.width === "number" ? borders.width : 1;
    var boxed = reviewCards.separator === "boxed";

    if (boxed) {
      // A fully-bounded card: border on all four sides, generous padding on every side,
      // real background/radius, and whatever shadow Card Appearance specifies.
      setVar(style, "--imagyn-review-card-border-width", borderWidth + "px");
      setVar(style, "--imagyn-review-card-padding", "var(--imagyn-space-px-lg, 24px)");
      setVar(style, "--imagyn-review-card-background", "var(--imagyn-color-surface, #ffffff)");
      setVar(style, "--imagyn-review-card-radius", "var(--imagyn-radius-md, 8px)");
      setVar(
        style,
        "--imagyn-review-card-shadow",
        CARD_SHADOW[(cards && cards.shadowIntensity) || "none"] || CARD_SHADOW.none,
      );
      return;
    }

    // Flat (the editorial default): a hairline top rule ("border") or no rule at all
    // ("spacing") — STOREFRONT_DESIGN_SYSTEM.md §16's "pick one, never both" choice — no
    // background, no radius, no shadow, matching the shipped Review Card redesign exactly.
    setVar(
      style,
      "--imagyn-review-card-border-width",
      (reviewCards.separator === "spacing" ? "0" : borderWidth) + "px 0px 0px 0px",
    );
    setVar(style, "--imagyn-review-card-padding", "var(--imagyn-space-px-xl, 40px) 0 0");
    setVar(style, "--imagyn-review-card-background", "transparent");
    setVar(style, "--imagyn-review-card-radius", "0px");
    setVar(style, "--imagyn-review-card-shadow", "none");
  }

  function applyButtons(style, buttons) {
    if (!buttons) return;
    // Applies to the reserved .imagyn-btn primitive only (imagyn-component-button.css) —
    // not yet wired into any currently-shipped reviews-widget.css button, same as before
    // this control existed. Real, live in the admin preview; zero effect on production
    // storefronts today.
    var preset = BUTTON_STYLE[buttons.style] || BUTTON_STYLE.solid;
    setVar(style, "--imagyn-btn-background", preset.background);
    setVar(style, "--imagyn-btn-color", preset.color);
    setVar(style, "--imagyn-btn-border-color", preset.borderColor);
  }

  function applyLayout(style, layout) {
    if (!layout) return;
    if (layout.maxContentWidth) {
      setVar(style, "--imagyn-ratings-section-max-width", layout.maxContentWidth + "px");
    } else {
      style.removeProperty("--imagyn-ratings-section-max-width");
    }
  }

  function applyAnimation(style, animation) {
    if (!animation) return;
    if (animation.motion === "reduced") {
      setVar(style, "--imagyn-duration-fast", "0ms");
      setVar(style, "--imagyn-duration-base", "0ms");
      setVar(style, "--imagyn-duration-slow", "0ms");
    } else {
      style.removeProperty("--imagyn-duration-fast");
      style.removeProperty("--imagyn-duration-base");
      style.removeProperty("--imagyn-duration-slow");
    }
  }

  window.ImagynAppearance = {
    // `target` defaults to :root so every widget inherits the same values with no
    // per-widget code; the admin preview iframe passes its own scoped container instead
    // so draft edits never leak outside the preview frame.
    apply: function (tokens, target) {
      if (!tokens) return;
      var style = (target || document.documentElement).style;

      applyTypography(style, tokens.typography);
      applyColors(style, tokens.colors);
      applySpacing(style, tokens.spacing);
      applyCorners(style, tokens.corners);
      applyBorders(style, tokens.borders);
      applyReviewCards(style, tokens.reviewCards, tokens.cards, tokens.borders);
      applyButtons(style, tokens.buttons);
      applyLayout(style, tokens.layout);
      applyAnimation(style, tokens.animation);
      // tokens.stars / tokens.images: reserved categories, no independent tokens yet.
    },
  };
})();
