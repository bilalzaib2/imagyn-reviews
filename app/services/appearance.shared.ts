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

export type AppearancePreset = "minimal" | "modern" | "editorial" | "luxury" | "custom";

export interface AppearanceTypographyTokens {
  /** 0.9–1.15 — multiplies every --imagyn-font-size-* at resolve time. One control, not
   *  seven, so the scale always stays internally proportional. */
  scale: number;
  /** Maps 1:1 to --imagyn-letter-spacing-{tight,normal}. */
  letterSpacing: "tight" | "normal";
  /** null = the shipped system font stack (--imagyn-tokens.css's own --imagyn-font-family
   *  default). Reserved for Brand Studio's future custom/uploaded font picker — already
   *  wired end-to-end (imagyn-appearance.js applies it the moment it's non-null) so adding
   *  that picker later is a UI-only change, not a resolver change. */
  fontFamily: string | null;
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
  density: "compact" | "balanced" | "spacious";
}

export interface AppearanceCornerTokens {
  /** px, 0–24 — the literal --imagyn-radius-md value a merchant sets directly on one
   *  slider; --imagyn-radius-{sm,lg} derive proportionally (0.5x / 1.5x) so every rounded
   *  surface stays in scale together. --imagyn-radius-full (pills) is never scaled by this
   *  (STOREFRONT_DESIGN_SYSTEM.md §6 — pills stay 999px regardless). Default 8 reproduces
   *  today's static --imagyn-radius-md exactly. */
  radius: number;
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
  /** STOREFRONT_DESIGN_SYSTEM.md §16's documented "border or whitespace, never both"
   *  choice, made merchant-configurable — plus a third option, "boxed", for merchants who
   *  want a fully-bounded card (background + border + radius + shadow) instead of the
   *  editorial hairline-only default. "boxed" is the only value that makes the Card
   *  Appearance category (below) visible. */
  separator: "border" | "spacing" | "boxed";
}

export interface AppearanceCardTokens {
  /** Only visible when reviewCards.separator === "boxed" — a flat card has no elevation to
   *  scale. Reuses the same --imagyn-shadow-* calm, low-contrast values already defined in
   *  imagyn-tokens.css for the Modal/Drawer/Lightbox, via a dedicated
   *  --imagyn-review-card-shadow variable (not those components' own shadow variable,
   *  same reasoning as --imagyn-review-card-border-width already being its own seam). */
  shadowIntensity: "none" | "subtle" | "medium";
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
  cards: AppearanceCardTokens;
  layout: AppearanceLayoutTokens;
  animation: AppearanceAnimationTokens;
}

// Bit-for-bit equivalent to imagyn-tokens.css's current static defaults once resolved to
// CSS — scale 1 = today's sizes, "balanced" density = today's spacing, radius 8 = today's
// static --imagyn-radius-md, "solid" buttons = today's button style, "border" review-card
// separator = the review card redesign already shipped, "none" shadow = today's flat
// cards. An unconfigured store therefore renders pixel-identically to today; nothing
// changes until a merchant edits Appearance.
export const getDefaultAppearanceTokens = (): AppearanceTokens => ({
  typography: { scale: 1, letterSpacing: "tight", fontFamily: null },
  colors: {
    textColor: null,
    starColor: "#f5a623",
    starEmptyColor: "rgba(0, 0, 0, 0.15)",
    borderColor: "rgba(0, 0, 0, 0.08)",
    surfaceColor: "#ffffff",
  },
  spacing: { density: "balanced" },
  corners: { radius: 8 },
  borders: { width: 1 },
  buttons: { style: "solid" },
  stars: {},
  images: {},
  // "border" matches the Review Card redesign as actually shipped: a hairline top rule
  // plus generous padding, not whitespace alone (STOREFRONT_DESIGN_SYSTEM.md §16's
  // "border" choice — the padding is how much room surrounds it, not a second method).
  reviewCards: { separator: "border" },
  cards: { shadowIntensity: "none" },
  layout: { maxContentWidth: null },
  animation: { motion: "full" },
});

export const cloneAppearanceTokens = (tokens: AppearanceTokens): AppearanceTokens =>
  JSON.parse(JSON.stringify(tokens)) as AppearanceTokens;

// Shallow-merges per category so a partially-saved record (e.g. only `colors` was ever
// touched) still resolves every other category to its documented default — the same
// defaults-as-floor guarantee widget.server.ts's parseSettings gives WidgetSettings.
// `base` defaults to the documented defaults, but callers may pass the merchant's current
// draft instead — that's how a Widget Style preset (only overriding structural categories
// like corners/spacing/buttons) is applied on top of, rather than replacing, whatever
// Accent Color the merchant already has (see app.appearance.tsx's preset click handler).
export const mergeAppearanceTokens = (
  partial: Partial<AppearanceTokens> | null | undefined,
  base: AppearanceTokens = getDefaultAppearanceTokens(),
): AppearanceTokens => {
  if (!partial) {
    return base;
  }

  return {
    typography: { ...base.typography, ...partial.typography },
    colors: { ...base.colors, ...partial.colors },
    spacing: { ...base.spacing, ...partial.spacing },
    corners: { ...base.corners, ...partial.corners },
    borders: { ...base.borders, ...partial.borders },
    buttons: { ...base.buttons, ...partial.buttons },
    stars: { ...base.stars, ...partial.stars },
    images: { ...base.images, ...partial.images },
    reviewCards: { ...base.reviewCards, ...partial.reviewCards },
    cards: { ...base.cards, ...partial.cards },
    layout: { ...base.layout, ...partial.layout },
    animation: { ...base.animation, ...partial.animation },
  };
};
