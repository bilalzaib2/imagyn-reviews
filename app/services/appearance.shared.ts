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

// Global Brand inheritance — every customer-facing surface this app renders, each a real,
// independently-fetched backend call (see each key's own consumer below). A surface with no
// SurfaceBrandOverride row for its key simply renders the current global Appearance tokens —
// this is the whole mechanism behind "a future widget automatically inherits the global
// brand": it needs a new entry in this union (a compile-time, not a schema, change) plus a
// call to getStorefrontAppearance(storeId, key), never a new database table of its own.
export type SurfaceKey =
  | "store_reviews" // api.reviews.store.tsx
  | "product_reviews" // api.reviews.tsx — also backs the standalone Product AI Summary block, same request
  | "review_carousel" // api.reviews.featured.tsx
  | "video_reviews_carousel" // api.reviews.video-carousel.tsx (Pro)
  | "trust_badge" // api.reviews.trust.tsx
  | "store_ai_summary" // api.reviews.store-ai-summary.tsx
  | "floating_reviews" // api.reviews.floating.tsx
  | "public_review_site" // reviewSite.server.ts
  | "review_request_landing"; // r.$token.tsx

export const SURFACE_KEYS: SurfaceKey[] = [
  "store_reviews",
  "product_reviews",
  "review_carousel",
  "video_reviews_carousel",
  "trust_badge",
  "store_ai_summary",
  "floating_reviews",
  "public_review_site",
  "review_request_landing",
];

export const SURFACE_LABELS: Record<SurfaceKey, string> = {
  store_reviews: "Store Reviews widget",
  product_reviews: "Product Reviews widget",
  review_carousel: "Review Carousel",
  video_reviews_carousel: "Video Reviews Carousel",
  trust_badge: "Trust Badge",
  store_ai_summary: "Store AI Summary block",
  floating_reviews: "Floating Reviews widget",
  public_review_site: "Public Review Site",
  review_request_landing: "Review request landing page",
};

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

export interface AppearanceImageTokens {
  /** null = no logo shown (the default). Rendered as a small brand mark at the top of the
   *  Ratings & Reviews summary (see imagyn-appearance.js's applyImages and
   *  imagyn-component-summary.css's .imagyn-summary__logo) — the one place all three widget
   *  types (Reviews, Rating Badge, Collection Badges) share, per this token contract's own
   *  "one shared source of truth" convention. Media Gallery/avatar treatments remain
   *  unimplemented — see AppearanceStarTokens above for that same "reserved, not yet needed"
   *  pattern this category used to be.
   */
  logoUrl: string | null;
}

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
  images: { logoUrl: null },
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

// Accessibility — WCAG 2.x relative-luminance contrast ratio between two real hex colors a
// merchant has actually set (never a heuristic/approximation). Used by Brand Studio to warn
// (not block — a merchant may have a legitimate reason) when their own chosen accent/text
// color against their own chosen surface color would render effectively unreadable text or
// controls. Returns null for a color this can't parse (e.g. `null` textColor, which means
// "inherit currentColor" and has no fixed contrast to check in the first place) rather than
// fabricating a number.
function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  const [cr, cg, cb] = [channel(r), channel(g), channel(b)];
  return 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
}

export function contrastRatio(hexA: string, hexB: string): number | null {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return null;

  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG 2.x AA for normal-size text — SC 1.4.3. Applies to real running text (the review
// body, the reviewer name, the rating numeral), which is what this threshold was written
// for.
export const WCAG_AA_MIN_CONTRAST = 4.5;

// SC 1.4.11 Non-text Contrast, for a graphical object against the colours ADJACENT to it.
// Deliberately NOT applied to the star colour against the card surface: see
// checkStarLegibility for why that pairing is the wrong measurement for a star rating.
export const WCAG_AA_MIN_NON_TEXT_CONTRAST = 3;

// Below this, a filled star is close enough to the card surface that the rating reads as
// blank rather than as a score. Not a WCAG number — an "is it there at all" floor, set low
// on purpose so it only catches genuinely invisible choices (a white or near-white star on a
// white card), never a merely soft one.
const MIN_STAR_VISIBILITY_CONTRAST = 1.5;

// HSV saturation above which a colour reads as a hue rather than as a grey. A star rating is
// understood by hue as much as by lightness — which is exactly why luminance contrast alone
// cannot judge one (see checkStarLegibility).
const MIN_STAR_CHROMA = 0.25;

/**
 * HSV saturation, 0 (a pure grey) to 1 (a fully saturated hue). Returns null for a colour
 * this cannot parse rather than guessing.
 */
function chromaOf(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Composites a possibly-translucent token value down onto an opaque surface so it can be
 * compared as a real rendered colour.
 *
 * starEmptyColor ships as `rgba(0, 0, 0, 0.15)` — a translucent overlay, not a hex — so
 * contrastRatio alone cannot see it. What a shopper actually looks at is that overlay already
 * blended with the card surface, which is what this returns.
 */
export function flattenOntoSurface(color: string, surfaceHex: string): string | null {
  const value = color.trim();
  const surface = hexToRgb(surfaceHex);
  if (!surface) return null;
  if (/^#?[a-f\d]{6}$/i.test(value)) return value.startsWith("#") ? value : `#${value}`;

  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value);
  if (!match) return null;

  const alpha = match[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(match[4])));
  const blended = [1, 2, 3].map((index) => {
    const channel = Number(match[index]);
    if (!Number.isFinite(channel)) return null;
    return Math.round(channel * alpha + surface[index - 1] * (1 - alpha));
  });
  if (blended.some((channel) => channel === null)) return null;

  return `#${blended.map((channel) => (channel as number).toString(16).padStart(2, "0")).join("")}`;
}

export interface StarLegibilityIssue {
  reason: "indistinguishable-from-empty" | "invisible-on-surface";
  ratio: number;
}

/**
 * Whether a star rating drawn in `starColor` can actually be read as a score.
 *
 * The question a star rating poses is not "does this colour contrast with the card?" — it is
 * "can I tell a filled star from an empty one?", because that difference IS the rating. So
 * this compares the filled star against the unfilled star it sits beside (SC 1.4.11's
 * adjacent-colour framing), not against the card surface.
 *
 * Crucially, that comparison cannot be luminance-only. WCAG's contrast ratio ignores hue, so
 * the conventional amber star (#f5a623) scores just 1.4:1 against the grey unfilled star it
 * sits next to and 2.0:1 against a white card — yet nobody has ever struggled to read an
 * Amazon star rating, because amber and grey differ in hue, and because this widget always
 * prints the numeral and review count as real text beside the stars. Judging stars by
 * luminance alone therefore condemns the one colour the entire category uses, which is how
 * Brand Studio came to show every merchant on default settings a contrast warning no amber
 * could ever clear.
 *
 * So a star is legible if it differs from the unfilled star in EITHER dimension — chroma (an
 * amber or brand hue against a grey) or luminance (a near-black star). A desaturated grey
 * fails both, which is precisely the case worth warning about: grey-on-grey stars render a
 * 3-star review and a 5-star review identical.
 */
export function checkStarLegibility(
  starColor: string,
  surfaceColor: string,
  starEmptyColor: string,
): StarLegibilityIssue | null {
  const surfaceRatio = contrastRatio(starColor, surfaceColor);
  if (surfaceRatio !== null && surfaceRatio < MIN_STAR_VISIBILITY_CONTRAST) {
    return { reason: "invisible-on-surface", ratio: surfaceRatio };
  }

  const chroma = chromaOf(starColor);
  if (chroma === null || chroma >= MIN_STAR_CHROMA) return null;

  const emptyHex = flattenOntoSurface(starEmptyColor, surfaceColor);
  const emptyRatio = emptyHex ? contrastRatio(starColor, emptyHex) : null;
  if (emptyRatio !== null && emptyRatio < WCAG_AA_MIN_NON_TEXT_CONTRAST) {
    return { reason: "indistinguishable-from-empty", ratio: emptyRatio };
  }

  return null;
}

export interface ContrastWarning {
  pair: "text-on-surface" | "star-vs-empty" | "star-on-surface";
  ratio: number;
}

// Real validation, not a fake control — only ever checks colour pairs this system actually
// renders together, and only ones a merchant can act on. Silently skips textColor when it's
// null ("inherit currentColor") since that has no fixed value to check against — this system
// cannot know the merchant's theme background at save time, so it never fabricates a pass or
// fail for that case.
export function checkAppearanceContrast(tokens: AppearanceTokens): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  const surface = tokens.colors.surfaceColor;

  if (tokens.colors.textColor) {
    const ratio = contrastRatio(tokens.colors.textColor, surface);
    if (ratio !== null && ratio < WCAG_AA_MIN_CONTRAST) {
      warnings.push({ pair: "text-on-surface", ratio });
    }
  }

  const starIssue = checkStarLegibility(tokens.colors.starColor, surface, tokens.colors.starEmptyColor);
  if (starIssue) {
    warnings.push({
      pair: starIssue.reason === "invisible-on-surface" ? "star-on-surface" : "star-vs-empty",
      ratio: starIssue.ratio,
    });
  }

  return warnings;
}
