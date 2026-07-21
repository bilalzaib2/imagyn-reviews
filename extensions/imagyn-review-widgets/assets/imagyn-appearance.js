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
  var BASE_RADIUS = { sm: 4, md: 8, lg: 12 };

  var DENSITY_MULTIPLIER = { compact: 0.75, comfortable: 1, spacious: 1.35 };
  var RADIUS_MULTIPLIER = { sharp: 0.5, soft: 1, round: 1.6 };

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
    if (!corners) return;
    var multiplier = RADIUS_MULTIPLIER[corners.radiusScale] || 1;
    for (var key in BASE_RADIUS) {
      if (Object.prototype.hasOwnProperty.call(BASE_RADIUS, key)) {
        setVar(style, "--imagyn-radius-" + key, Math.round(BASE_RADIUS[key] * multiplier) + "px");
      }
    }
    // --imagyn-radius-full is deliberately never scaled (STOREFRONT_DESIGN_SYSTEM.md §6 —
    // pills stay 999px regardless of this control).
  }

  function applyBorders(style, borders) {
    if (!borders || typeof borders.width !== "number") return;
    setVar(style, "--imagyn-border-width", borders.width + "px");
  }

  function applyReviewCards(style, reviewCards) {
    if (!reviewCards) return;
    // "spacing" = whitespace-only (STOREFRONT_DESIGN_SYSTEM.md §16's other documented
    // choice) — forces the review card's own dedicated border-width seam to 0 without
    // touching the generic --imagyn-border-width other elements (form fields, sort
    // select) also depend on. "border" leaves it unset so the card's own fallback chain
    // (its own var → --imagyn-border-width) resolves normally.
    if (reviewCards.separator === "spacing") {
      setVar(style, "--imagyn-review-card-border-width", "0px");
    } else {
      style.removeProperty("--imagyn-review-card-border-width");
    }
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
      applyReviewCards(style, tokens.reviewCards);
      applyLayout(style, tokens.layout);
      applyAnimation(style, tokens.animation);
      // tokens.buttons / tokens.stars / tokens.images: stored and shown in the admin
      // preview against the reserved .imagyn-btn component (imagyn-component-button.css)
      // for forward-looking widgets, but not wired into any currently-shipped button —
      // reviews-widget.css's existing buttons aren't being redesigned in this pass.
    },
  };
})();
