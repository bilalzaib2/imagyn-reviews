/**
 * The Review Carousel's customization contract.
 *
 * ONE module owns four things that must never disagree: the setting shape, the defaults, the
 * five presets, and the mapping from settings to CSS custom properties. The admin preview and
 * the storefront renderer both consume `carouselCssVariables`, which is what keeps requirement
 * 9 ("the storefront renderer and dashboard preview must be visually consistent") true by
 * construction rather than by two teams remembering to match each other.
 *
 * This file is deliberately framework-free and server-free: the admin imports it directly, and
 * the storefront gets the same values as a plain object over the existing reviews API, so the
 * extension never has to reimplement any of this arithmetic in its own ES5.
 *
 * Persistence reuses the existing architecture rather than adding a parallel one — these
 * settings live in `Widget.settings.carousel` on the store-wide `type: "review-carousel"` row,
 * so tenant isolation, resolution and defaulting all come from widget.server.ts unchanged.
 */

export type ImageVisibility = "always" | "never" | "when-present";
export type ImagePosition = "above" | "below" | "left" | "right" | "background";
export type ImageSize = "small" | "medium" | "large" | "custom";
export type ImageAspectRatio = "original" | "square" | "portrait" | "landscape";
export type ImageFit = "cover" | "contain";
export type FontFamilyChoice = "theme" | "system" | "serif";
export type FontWeightChoice = "regular" | "medium" | "semibold";
export type TextAlign = "left" | "center" | "right";
export type TextDisplay = "full" | "truncate";
export type BorderStyle = "solid" | "dashed" | "none";
export type ShadowChoice = "none" | "subtle" | "medium" | "strong";
export type HoverEffect = "none" | "lift" | "zoom";
export type ArrowPosition = "inside" | "outside";
export type DotStyle = "dot" | "bar";
export type VerifiedBadgeStyle = "icon" | "text" | "both";

export interface CarouselSettings {
  // ---- Images -------------------------------------------------------------------------
  imageVisibility: ImageVisibility;
  imagePosition: ImagePosition;
  imageSize: ImageSize;
  /** Only consulted when imageSize === "custom". */
  imageCustomHeight: number;
  imageAspectRatio: ImageAspectRatio;
  imageFit: ImageFit;
  imageRadius: number;
  imageBorderWidth: number;
  imageBorderColor: string;
  imageSpacing: number;
  imageHoverZoom: boolean;

  // ---- Content visibility -------------------------------------------------------------
  showTitle: boolean;
  showBody: boolean;
  showReviewerName: boolean;
  showDate: boolean;
  showProductName: boolean;
  showProductImage: boolean;
  showRating: boolean;
  showVerifiedBadge: boolean;
  showMedia: boolean;

  // ---- Typography ---------------------------------------------------------------------
  fontFamily: FontFamilyChoice;
  titleFontSize: number;
  bodyFontSize: number;
  nameFontSize: number;
  fontWeight: FontWeightChoice;
  textColor: string;
  mutedTextColor: string;
  lineHeight: number;
  textAlign: TextAlign;

  // ---- Text display -------------------------------------------------------------------
  textDisplay: TextDisplay;
  maxLines: number;
  readMore: boolean;
  contentSpacing: number;

  // ---- Card ---------------------------------------------------------------------------
  cardRadius: number;
  cardBackground: string;
  cardBorderColor: string;
  cardBorderWidth: number;
  cardBorderStyle: BorderStyle;
  cardShadow: ShadowChoice;
  cardPadding: number;
  cardMinHeight: number;
  equalHeight: boolean;
  starColor: string;
  verifiedBadgeStyle: VerifiedBadgeStyle;
  hoverEffect: HoverEffect;
  transitionMs: number;

  // ---- Layout & behaviour -------------------------------------------------------------
  cardsDesktop: number;
  cardsTablet: number;
  cardsMobile: number;
  cardGap: number;
  autoplay: boolean;
  autoplaySpeed: number;
  loop: boolean;
  showArrows: boolean;
  arrowPosition: ArrowPosition;
  showDots: boolean;
  dotStyle: DotStyle;
  animationMs: number;
  swipe: boolean;
}

/**
 * Safe bounds for every numeric setting.
 *
 * These are not cosmetic preferences — they are the difference between a merchant nudging a
 * slider and a merchant breaking their own storefront. A 400px card gap or a 0ms transition
 * is not a style, it is a broken page, so the clamp lives here rather than relying on the UI
 * to only ever send good values. normalizeCarouselSettings applies them to anything inbound.
 */
export const CAROUSEL_LIMITS = {
  imageCustomHeight: { min: 80, max: 600 },
  imageRadius: { min: 0, max: 32 },
  imageBorderWidth: { min: 0, max: 8 },
  imageSpacing: { min: 0, max: 32 },
  titleFontSize: { min: 12, max: 28 },
  bodyFontSize: { min: 11, max: 24 },
  nameFontSize: { min: 10, max: 20 },
  lineHeight: { min: 1.1, max: 2.2 },
  maxLines: { min: 1, max: 12 },
  contentSpacing: { min: 2, max: 32 },
  cardRadius: { min: 0, max: 32 },
  cardBorderWidth: { min: 0, max: 8 },
  cardPadding: { min: 0, max: 48 },
  cardMinHeight: { min: 0, max: 640 },
  transitionMs: { min: 0, max: 1200 },
  cardsDesktop: { min: 1, max: 6 },
  cardsTablet: { min: 1, max: 4 },
  cardsMobile: { min: 1, max: 3 },
  cardGap: { min: 0, max: 64 },
  autoplaySpeed: { min: 2, max: 30 },
  animationMs: { min: 0, max: 1500 },
} as const;

export const DEFAULT_CAROUSEL_SETTINGS: CarouselSettings = {
  imageVisibility: "when-present",
  imagePosition: "above",
  imageSize: "medium",
  imageCustomHeight: 220,
  imageAspectRatio: "landscape",
  imageFit: "cover",
  imageRadius: 8,
  imageBorderWidth: 0,
  imageBorderColor: "#e6e6e6",
  imageSpacing: 12,
  imageHoverZoom: false,

  showTitle: true,
  showBody: true,
  showReviewerName: true,
  showDate: true,
  showProductName: true,
  showProductImage: false,
  showRating: true,
  showVerifiedBadge: true,
  showMedia: true,

  fontFamily: "theme",
  titleFontSize: 16,
  bodyFontSize: 14,
  nameFontSize: 13,
  fontWeight: "medium",
  textColor: "#1a1a1a",
  mutedTextColor: "#6b6b6b",
  lineHeight: 1.5,
  textAlign: "left",

  textDisplay: "truncate",
  maxLines: 4,
  readMore: true,
  contentSpacing: 10,

  cardRadius: 12,
  cardBackground: "#ffffff",
  cardBorderColor: "#e6e6e6",
  cardBorderWidth: 1,
  cardBorderStyle: "solid",
  cardShadow: "subtle",
  cardPadding: 16,
  cardMinHeight: 0,
  equalHeight: true,
  starColor: "#f5a623",
  verifiedBadgeStyle: "both",
  hoverEffect: "lift",
  transitionMs: 200,

  cardsDesktop: 3,
  cardsTablet: 2,
  cardsMobile: 1,
  cardGap: 16,
  autoplay: false,
  autoplaySpeed: 5,
  loop: true,
  showArrows: true,
  arrowPosition: "inside",
  showDots: false,
  dotStyle: "dot",
  animationMs: 400,
  swipe: true,
};

export type CarouselPresetId = "minimal" | "editorial" | "modern" | "image-focused" | "compact";

export interface CarouselPreset {
  id: CarouselPresetId;
  name: string;
  description: string;
  /**
   * A partial, not a whole settings object. A preset expresses the handful of decisions that
   * make it that preset; everything it does not mention keeps the default. That is also what
   * makes presets a starting point rather than a template — applying one and then changing a
   * single control is the normal path, not an escape hatch.
   */
  settings: Partial<CarouselSettings>;
}

export const CAROUSEL_PRESETS: CarouselPreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean cards, hairline borders, restrained type.",
    settings: {
      cardRadius: 6,
      cardShadow: "none",
      cardBorderWidth: 1,
      cardBorderColor: "#e6e6e6",
      cardPadding: 16,
      imageRadius: 4,
      imageSize: "small",
      titleFontSize: 15,
      bodyFontSize: 13,
      fontWeight: "regular",
      hoverEffect: "none",
      cardGap: 12,
    },
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Elegant type, generous spacing, quiet furniture.",
    settings: {
      cardRadius: 0,
      cardShadow: "none",
      cardBorderWidth: 0,
      cardBorderStyle: "none",
      cardPadding: 28,
      contentSpacing: 16,
      fontFamily: "serif",
      titleFontSize: 20,
      bodyFontSize: 16,
      lineHeight: 1.7,
      textAlign: "left",
      imagePosition: "above",
      imageRadius: 0,
      imageAspectRatio: "portrait",
      cardsDesktop: 2,
      cardGap: 32,
      maxLines: 6,
      hoverEffect: "none",
    },
  },
  {
    id: "modern",
    name: "Modern",
    description: "Rounded cards, soft shadow, contemporary spacing.",
    settings: {
      cardRadius: 20,
      cardShadow: "medium",
      cardBorderWidth: 0,
      cardBorderStyle: "none",
      cardPadding: 20,
      imageRadius: 14,
      imageAspectRatio: "landscape",
      titleFontSize: 17,
      fontWeight: "semibold",
      hoverEffect: "lift",
      transitionMs: 260,
      cardGap: 20,
    },
  },
  {
    id: "image-focused",
    name: "Image Focused",
    description: "Large review photography, text in support.",
    settings: {
      imageVisibility: "when-present",
      imagePosition: "above",
      imageSize: "large",
      imageAspectRatio: "square",
      imageFit: "cover",
      imageRadius: 12,
      imageHoverZoom: true,
      showTitle: false,
      maxLines: 3,
      textDisplay: "truncate",
      bodyFontSize: 13,
      cardPadding: 12,
      cardShadow: "subtle",
      cardsDesktop: 3,
    },
  },
  {
    id: "compact",
    name: "Compact",
    description: "Efficient cards that fit more reviews in view.",
    settings: {
      imageVisibility: "never",
      cardPadding: 12,
      cardRadius: 8,
      cardShadow: "none",
      cardBorderWidth: 1,
      contentSpacing: 6,
      titleFontSize: 14,
      bodyFontSize: 12,
      nameFontSize: 11,
      maxLines: 2,
      textDisplay: "truncate",
      readMore: false,
      showDate: false,
      showProductName: false,
      cardsDesktop: 4,
      cardsTablet: 3,
      cardsMobile: 1,
      cardGap: 10,
      equalHeight: true,
    },
  },
];

export function getCarouselPreset(id: string): CarouselPreset | undefined {
  return CAROUSEL_PRESETS.find((preset) => preset.id === id);
}

/** Applying a preset never discards the settings it does not mention. */
export function applyCarouselPreset(current: CarouselSettings, id: string): CarouselSettings {
  const preset = getCarouselPreset(id);
  if (!preset) return current;
  return normalizeCarouselSettings({ ...current, ...preset.settings });
}

function clampNumber(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, bounds.min), bounds.max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Colours are restricted to a hex literal on purpose.
 *
 * These values are interpolated into a style attribute on the storefront, so accepting
 * arbitrary strings would hand a merchant — or anyone who could reach the save endpoint — a
 * CSS injection point (`red; background: url(...)`), and CSS can exfiltrate and deface. A
 * strict hex test is the whole defence, and anything failing it falls back to the default
 * rather than being "cleaned", because a half-sanitised colour is a bug pretending to be a
 * feature.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/**
 * Turns anything at all into a valid settings object.
 *
 * Used on the way in from the merchant form, on the way out of the database, and on the way
 * into the storefront payload. Settings saved before a new control existed simply pick up that
 * control's default, which is what makes adding a control a non-breaking change for every
 * merchant who already saved a configuration.
 */
export function normalizeCarouselSettings(raw: unknown): CarouselSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CAROUSEL_SETTINGS;
  const L = CAROUSEL_LIMITS;

  return {
    imageVisibility: oneOf(input.imageVisibility, ["always", "never", "when-present"] as const, d.imageVisibility),
    imagePosition: oneOf(input.imagePosition, ["above", "below", "left", "right", "background"] as const, d.imagePosition),
    imageSize: oneOf(input.imageSize, ["small", "medium", "large", "custom"] as const, d.imageSize),
    imageCustomHeight: clampNumber(input.imageCustomHeight, d.imageCustomHeight, L.imageCustomHeight),
    imageAspectRatio: oneOf(input.imageAspectRatio, ["original", "square", "portrait", "landscape"] as const, d.imageAspectRatio),
    imageFit: oneOf(input.imageFit, ["cover", "contain"] as const, d.imageFit),
    imageRadius: clampNumber(input.imageRadius, d.imageRadius, L.imageRadius),
    imageBorderWidth: clampNumber(input.imageBorderWidth, d.imageBorderWidth, L.imageBorderWidth),
    imageBorderColor: color(input.imageBorderColor, d.imageBorderColor),
    imageSpacing: clampNumber(input.imageSpacing, d.imageSpacing, L.imageSpacing),
    imageHoverZoom: bool(input.imageHoverZoom, d.imageHoverZoom),

    showTitle: bool(input.showTitle, d.showTitle),
    showBody: bool(input.showBody, d.showBody),
    showReviewerName: bool(input.showReviewerName, d.showReviewerName),
    showDate: bool(input.showDate, d.showDate),
    showProductName: bool(input.showProductName, d.showProductName),
    showProductImage: bool(input.showProductImage, d.showProductImage),
    showRating: bool(input.showRating, d.showRating),
    showVerifiedBadge: bool(input.showVerifiedBadge, d.showVerifiedBadge),
    showMedia: bool(input.showMedia, d.showMedia),

    fontFamily: oneOf(input.fontFamily, ["theme", "system", "serif"] as const, d.fontFamily),
    titleFontSize: clampNumber(input.titleFontSize, d.titleFontSize, L.titleFontSize),
    bodyFontSize: clampNumber(input.bodyFontSize, d.bodyFontSize, L.bodyFontSize),
    nameFontSize: clampNumber(input.nameFontSize, d.nameFontSize, L.nameFontSize),
    fontWeight: oneOf(input.fontWeight, ["regular", "medium", "semibold"] as const, d.fontWeight),
    textColor: color(input.textColor, d.textColor),
    mutedTextColor: color(input.mutedTextColor, d.mutedTextColor),
    lineHeight: clampNumber(input.lineHeight, d.lineHeight, L.lineHeight),
    textAlign: oneOf(input.textAlign, ["left", "center", "right"] as const, d.textAlign),

    textDisplay: oneOf(input.textDisplay, ["full", "truncate"] as const, d.textDisplay),
    maxLines: clampNumber(input.maxLines, d.maxLines, L.maxLines),
    readMore: bool(input.readMore, d.readMore),
    contentSpacing: clampNumber(input.contentSpacing, d.contentSpacing, L.contentSpacing),

    cardRadius: clampNumber(input.cardRadius, d.cardRadius, L.cardRadius),
    cardBackground: color(input.cardBackground, d.cardBackground),
    cardBorderColor: color(input.cardBorderColor, d.cardBorderColor),
    cardBorderWidth: clampNumber(input.cardBorderWidth, d.cardBorderWidth, L.cardBorderWidth),
    cardBorderStyle: oneOf(input.cardBorderStyle, ["solid", "dashed", "none"] as const, d.cardBorderStyle),
    cardShadow: oneOf(input.cardShadow, ["none", "subtle", "medium", "strong"] as const, d.cardShadow),
    cardPadding: clampNumber(input.cardPadding, d.cardPadding, L.cardPadding),
    cardMinHeight: clampNumber(input.cardMinHeight, d.cardMinHeight, L.cardMinHeight),
    equalHeight: bool(input.equalHeight, d.equalHeight),
    starColor: color(input.starColor, d.starColor),
    verifiedBadgeStyle: oneOf(input.verifiedBadgeStyle, ["icon", "text", "both"] as const, d.verifiedBadgeStyle),
    hoverEffect: oneOf(input.hoverEffect, ["none", "lift", "zoom"] as const, d.hoverEffect),
    transitionMs: clampNumber(input.transitionMs, d.transitionMs, L.transitionMs),

    cardsDesktop: Math.round(clampNumber(input.cardsDesktop, d.cardsDesktop, L.cardsDesktop)),
    cardsTablet: Math.round(clampNumber(input.cardsTablet, d.cardsTablet, L.cardsTablet)),
    cardsMobile: Math.round(clampNumber(input.cardsMobile, d.cardsMobile, L.cardsMobile)),
    cardGap: clampNumber(input.cardGap, d.cardGap, L.cardGap),
    autoplay: bool(input.autoplay, d.autoplay),
    autoplaySpeed: clampNumber(input.autoplaySpeed, d.autoplaySpeed, L.autoplaySpeed),
    loop: bool(input.loop, d.loop),
    showArrows: bool(input.showArrows, d.showArrows),
    arrowPosition: oneOf(input.arrowPosition, ["inside", "outside"] as const, d.arrowPosition),
    showDots: bool(input.showDots, d.showDots),
    dotStyle: oneOf(input.dotStyle, ["dot", "bar"] as const, d.dotStyle),
    animationMs: clampNumber(input.animationMs, d.animationMs, L.animationMs),
    swipe: bool(input.swipe, d.swipe),
  };
}

const SHADOW_VALUES: Record<ShadowChoice, string> = {
  none: "none",
  subtle: "0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.08)",
  medium: "0 4px 8px -2px rgba(16,24,40,0.08), 0 2px 4px -2px rgba(16,24,40,0.06)",
  strong: "0 12px 24px -6px rgba(16,24,40,0.14), 0 4px 8px -4px rgba(16,24,40,0.08)",
};

const ASPECT_VALUES: Record<ImageAspectRatio, string> = {
  original: "auto",
  square: "1 / 1",
  portrait: "4 / 5",
  landscape: "16 / 9",
};

const IMAGE_HEIGHTS: Record<Exclude<ImageSize, "custom">, number> = {
  small: 140,
  medium: 220,
  large: 320,
};

const FONT_STACKS: Record<FontFamilyChoice, string> = {
  // "theme" intentionally resolves to `inherit`, so the merchant's own storefront typeface
  // flows through instead of Imagyn imposing one. It is the default for that reason.
  theme: "inherit",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
};

const FONT_WEIGHTS: Record<FontWeightChoice, number> = { regular: 400, medium: 500, semibold: 600 };

/**
 * The single source of visual truth, consumed by both renderers.
 *
 * Returns plain CSS custom properties rather than a stylesheet, so the storefront can set them
 * on its own scoped container and the admin preview can set them on a div — same numbers, same
 * names, no second implementation. Every property is namespaced `--imagyn-carousel-*`, which
 * is what keeps these values scoped to the widget and unable to collide with a merchant's
 * theme (requirement 8).
 */
export function carouselCssVariables(settings: CarouselSettings): Record<string, string> {
  const imageHeight =
    settings.imageSize === "custom" ? settings.imageCustomHeight : IMAGE_HEIGHTS[settings.imageSize];

  return {
    "--imagyn-carousel-cards-desktop": String(settings.cardsDesktop),
    "--imagyn-carousel-cards-tablet": String(settings.cardsTablet),
    "--imagyn-carousel-cards-mobile": String(settings.cardsMobile),
    "--imagyn-carousel-gap": `${settings.cardGap}px`,
    "--imagyn-carousel-content-gap": `${settings.contentSpacing}px`,

    "--imagyn-carousel-card-bg": settings.cardBackground,
    "--imagyn-carousel-card-radius": `${settings.cardRadius}px`,
    "--imagyn-carousel-card-padding": `${settings.cardPadding}px`,
    "--imagyn-carousel-card-border-color": settings.cardBorderColor,
    "--imagyn-carousel-card-border-width": `${settings.cardBorderStyle === "none" ? 0 : settings.cardBorderWidth}px`,
    "--imagyn-carousel-card-border-style": settings.cardBorderStyle === "none" ? "none" : settings.cardBorderStyle,
    "--imagyn-carousel-card-shadow": SHADOW_VALUES[settings.cardShadow],
    "--imagyn-carousel-card-min-height": settings.cardMinHeight > 0 ? `${settings.cardMinHeight}px` : "auto",

    "--imagyn-carousel-image-ratio": ASPECT_VALUES[settings.imageAspectRatio],
    "--imagyn-carousel-image-height": settings.imageAspectRatio === "original" ? `${imageHeight}px` : "auto",
    "--imagyn-carousel-image-max-height": `${imageHeight}px`,
    "--imagyn-carousel-image-fit": settings.imageFit,
    "--imagyn-carousel-image-radius": `${settings.imageRadius}px`,
    "--imagyn-carousel-image-border-width": `${settings.imageBorderWidth}px`,
    "--imagyn-carousel-image-border-color": settings.imageBorderColor,
    "--imagyn-carousel-image-spacing": `${settings.imageSpacing}px`,
    "--imagyn-carousel-image-zoom": settings.imageHoverZoom ? "1.06" : "1",

    "--imagyn-carousel-font-family": FONT_STACKS[settings.fontFamily],
    "--imagyn-carousel-title-size": `${settings.titleFontSize}px`,
    "--imagyn-carousel-body-size": `${settings.bodyFontSize}px`,
    "--imagyn-carousel-name-size": `${settings.nameFontSize}px`,
    "--imagyn-carousel-font-weight": String(FONT_WEIGHTS[settings.fontWeight]),
    "--imagyn-carousel-text-color": settings.textColor,
    "--imagyn-carousel-muted-color": settings.mutedTextColor,
    "--imagyn-carousel-line-height": String(settings.lineHeight),
    "--imagyn-carousel-text-align": settings.textAlign,
    "--imagyn-carousel-max-lines": settings.textDisplay === "truncate" ? String(settings.maxLines) : "unset",

    "--imagyn-carousel-star-color": settings.starColor,
    // Honouring prefers-reduced-motion is not a setting a merchant gets to override, so a
    // transition of 0 is also what the media query in the stylesheet forces.
    "--imagyn-carousel-transition": `${settings.transitionMs}ms`,
    "--imagyn-carousel-animation": `${settings.animationMs}ms`,
    "--imagyn-carousel-hover-lift": settings.hoverEffect === "lift" ? "-2px" : "0px",
    "--imagyn-carousel-hover-scale": settings.hoverEffect === "zoom" ? "1.02" : "1",
  };
}

/** The same variables as an inline `style` string, for the storefront's ES5 renderer. */
export function carouselCssText(settings: CarouselSettings): string {
  return Object.entries(carouselCssVariables(settings))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}
