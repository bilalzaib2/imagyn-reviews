// Imagyn Reviews — Appearance System token contract.
//
// The single, centralized set of design tokens every storefront widget (Product Reviews,
// Product Rating Badge, Collection Rating Badge, and every future one — Carousel,
// Testimonials, Floating Rating, Homepage Sections, ...) consumes. Each field here maps
// to a specific, real --imagyn-* CSS custom property already defined in
// extensions/imagyn-review-widgets/assets/imagyn-tokens.css and consumed throughout that
// extension's component CSS files — see docs/STOREFRONT_DESIGN_SYSTEM.md for the full
// token catalogue this contract resolves onto.
//
// This is a deliberate reduction, not a re-skin, of the older, disconnected
// WidgetSettings shape (widget.shared.ts): that interface has ~40 flat fields, only a
// handful of which the real storefront ever reads, with the rest only ever feeding
// app.widgets.tsx's own mocked, non-real preview. This contract exposes 11 curated
// controls (enums/multipliers, not raw pixel values per field) so the admin surface stays
// a small, premium set of decisions rather than a worksheet — matching
// STOREFRONT_DESIGN_SYSTEM.md §1's restraint principle.
//
// Deliberately excluded, never part of this contract:
//   - --imagyn-font-family: STOREFRONT_DESIGN_SYSTEM.md §3 — a permanent, documented
//     decision (no external fonts, ever), not a placeholder awaiting a control.
//   - --imagyn-color-success / --imagyn-color-danger / --imagyn-color-focus: semantic/
//     system colors (§7 — "exactly one deliberate brand accent plus two semantic
//     colors"). Exposing these would reintroduce the old primaryColor/accentColor/
//     buttonColor sprawl this system replaces.
//   - List/Grid/Carousel layout mode: STOREFRONT_ARCHITECTURE.md — Review List is
//     single-column at every breakpoint "by deliberate density choice, not a responsive
//     fallback," not a merchant-configurable axis here.
//
// Follow-up (not built in this pass): app.widgets.tsx's own "Appearance" InspectorSection
// still writes real, live WidgetSettings color/type fields that reviews-widget.js's
// applyStyle() actually applies (a separate --imagyn-star-color/--imagyn-text-color
// variable family, untouched by this system). Once this Appearance System is proven, that
// section should become a per-instance override layered on top of these global defaults,
// rather than a parallel, disconnected mechanism — a source-of-truth redirect, not a
// deletion, and out of scope for this pass ("do not redesign existing widgets").

export type AppearancePreset = "minimal" | "modern" | "editorial" | "classic" | "custom";

export interface AppearanceTypographyTokens {
  /** 0.9–1.15 — multiplies every --imagyn-font-size-* at resolve time. One control, not
   *  seven, so the scale always stays internally proportional. */
  scale: number;
  /** Maps 1:1 to --imagyn-letter-spacing-{tight,normal}. */
  letterSpacing: "tight" | "normal";
}

export interface AppearanceColorTokens {
  /** null = inherit currentColor (--imagyn-color-text's documented default). Set only if
   *  a merchant wants a fixed color instead of inheriting the theme's own text color. */
  textColor: string | null;
  /** --imagyn-color-star — "the one deliberate brand accent color in the entire system." */
  starColor: string;
  /** --imagyn-color-star-empty. */
  starEmptyColor: string;
  /** --imagyn-color-border. */
  borderColor: string;
  /** --imagyn-color-surface. */
  surfaceColor: string;
}

export interface AppearanceSpacingTokens {
  /** Resolves to a coordinated multiplier applied to BOTH the em-based --imagyn-space-*
   *  and px-based --imagyn-space-px-* scales together, so within-component and
   *  between-component spacing (§5's own distinction) can never desync from one
   *  another via this control. */
  density: "compact" | "comfortable" | "spacious";
}

export interface AppearanceCornerTokens {
  /** Proportional scale over --imagyn-radius-{sm,md,lg}. --imagyn-radius-full (pills) is
   *  categorical, not scalar, and stays fixed at 999px regardless of this setting. */
  radiusScale: "sharp" | "soft" | "round";
}

export interface AppearanceBorderTokens {
  /** px, 0–2 — --imagyn-border-width. 0 reproduces the "no border, whitespace only"
   *  editorial default already shipped for the Review Card list layout. */
  width: number;
}

export interface AppearanceButtonTokens {
  style: "solid" | "outline" | "ghost";
}

// Reserved category — no independent star size/shape token exists in the current design
// system (fixed at 0.9em within components, per §16). A home for a future control
// without restructuring this contract when one is added.
export type AppearanceStarTokens = Record<string, never>;

// Reserved category — the Media Gallery and avatar treatments currently inherit Corners
// and have no dedicated tokens of their own. Extension seam only; do not add speculative
// fields until a widget actually needs them.
export type AppearanceImageTokens = Record<string, never>;

export interface AppearanceReviewCardTokens {
  /** STOREFRONT_DESIGN_SYSTEM.md §16: "Cards separate via a hairline border or
   *  whitespace — pick one per implementation, never both." This is that documented
   *  choice, made merchant-configurable rather than hardcoded. */
  separator: "border" | "spacing";
}

export interface AppearanceLayoutTokens {
  /** Optional max-width (px) for the Ratings & Reviews section shell. null = the
   *  section's own current default (1200px, imagyn-component-ratings-section.css). */
  maxContentWidth: number | null;
}

export interface AppearanceAnimationTokens {
  /** "reduced" resolves every --imagyn-duration-* to 0ms — independent of, but with the
   *  same effect as, the visitor's own prefers-reduced-motion. */
  motion: "full" | "reduced";
}

export interface AppearanceTokens {
  typography: AppearanceTypographyTokens;
  colors: AppearanceColorTokens;
  spacing: AppearanceSpacingTokens;
  corners: AppearanceCornerTokens;
  borders: AppearanceBorderTokens;
  buttons: AppearanceButtonTokens;
  stars: AppearanceStarTokens;
  images: AppearanceImageTokens;
  reviewCards: AppearanceReviewCardTokens;
  layout: AppearanceLayoutTokens;
  animation: AppearanceAnimationTokens;
}

// Bit-for-bit equivalent to imagyn-tokens.css's current static defaults once resolved to
// CSS — scale 1 = today's sizes, "comfortable" density = today's spacing, "soft" corners
// = today's radii, "solid" buttons = today's button style, "spacing" review-card
// separator = the review card redesign already shipped. An unconfigured store therefore
// renders pixel-identically to today; nothing changes until a merchant edits Appearance.
export const getDefaultAppearanceTokens = (): AppearanceTokens => ({
  typography: { scale: 1, letterSpacing: "tight" },
  colors: {
    textColor: null,
    starColor: "#f5a623",
    starEmptyColor: "rgba(0, 0, 0, 0.15)",
    borderColor: "rgba(0, 0, 0, 0.08)",
    surfaceColor: "#ffffff",
  },
  spacing: { density: "comfortable" },
  corners: { radiusScale: "soft" },
  borders: { width: 1 },
  buttons: { style: "solid" },
  stars: {},
  images: {},
  // "border" matches the Review Card redesign as actually shipped: a hairline top rule
  // plus generous padding, not whitespace alone (STOREFRONT_DESIGN_SYSTEM.md §16's
  // "border" choice — the padding is how much room surrounds it, not a second method).
  reviewCards: { separator: "border" },
  layout: { maxContentWidth: null },
  animation: { motion: "full" },
});

export const cloneAppearanceTokens = (tokens: AppearanceTokens): AppearanceTokens =>
  JSON.parse(JSON.stringify(tokens)) as AppearanceTokens;

// Shallow-merges per category so a partially-saved record (e.g. only `colors` was ever
// touched) still resolves every other category to its documented default — the same
// defaults-as-floor guarantee widget.server.ts's parseSettings gives WidgetSettings.
export const mergeAppearanceTokens = (partial: Partial<AppearanceTokens> | null | undefined): AppearanceTokens => {
  const defaults = getDefaultAppearanceTokens();
  if (!partial) {
    return defaults;
  }

  return {
    typography: { ...defaults.typography, ...partial.typography },
    colors: { ...defaults.colors, ...partial.colors },
    spacing: { ...defaults.spacing, ...partial.spacing },
    corners: { ...defaults.corners, ...partial.corners },
    borders: { ...defaults.borders, ...partial.borders },
    buttons: { ...defaults.buttons, ...partial.buttons },
    stars: { ...defaults.stars, ...partial.stars },
    images: { ...defaults.images, ...partial.images },
    reviewCards: { ...defaults.reviewCards, ...partial.reviewCards },
    layout: { ...defaults.layout, ...partial.layout },
    animation: { ...defaults.animation, ...partial.animation },
  };
};
