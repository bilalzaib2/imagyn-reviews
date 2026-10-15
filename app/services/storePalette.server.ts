// Reads the colours a merchant's own storefront actually uses, so a brand suggestion can be
// based on their real design instead of guesswork.
//
// Why scrape the storefront at all: Shopify's Admin GraphQL exposes no brand colour or logo
// anywhere — there is no `Shop.brand` field and no brand-related query on QueryRoot (both
// confirmed against the schema). The storefront is therefore the only universally available
// source, and it has the advantage of being exactly what shoppers see. It also needs no new
// access scope, which matters: adding one would force every existing merchant to re-consent.
//
// Everything here degrades to null rather than guessing. A suggestion built on a colour we
// invented would be worse than one that admits it had nothing to go on.
import { contrastRatio } from "./appearance.shared";

export interface StorePalette {
  /** The most brand-like chromatic colour found, if any. */
  accent: string | null;
  /** The page background, used to tell a light storefront from a dark one. */
  background: string | null;
  /** Every distinct chromatic candidate, most brand-like first. */
  candidates: string[];
}

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1_500_000;

// Custom-property names themes use for the colour a brand is actually recognised by, most
// specific first. Ranking by name beats ranking by frequency: a theme repeats its border
// grey hundreds of times and names its brand colour once.
const BRAND_NAME_HINTS = [
  "brand",
  "accent",
  "button",
  "btn",
  "link",
  "theme-color",
];

// Names that look brand-like to a substring match but describe something else entirely.
// Every one of these was found on a real storefront: `--primary-price-color` (a sale price)
// scored as "primary" and `--t4s-tooltip-background` scored as a page background, which is
// how a white store with black buttons was first read as dark red on dark grey.
const EXCLUDED_NAME_PARTS = [
  "price",
  "sale",
  "tooltip",
  "error",
  "danger",
  "success",
  "warning",
  "info",
  "stock",
  "overlay",
  "shadow",
  "gradient",
  "badge",
  "rating",
  "star",
  "compare",
  "wishlist",
];

// An explicit allow-list, not a substring match: only these name the PAGE background. Any
// "*-background" would otherwise match a tooltip, a badge or a dropdown.
const BACKGROUND_NAMES = [
  "color-background",
  "color-base-background-1",
  "bg-color",
  "body-bg",
  "page-background",
  "background-color",
];

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => clampChannel(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Parses the colour notations Shopify themes actually put in custom properties: hex (3 or 6
 * digit), `rgb()/rgba()`, and Dawn's bare `r, g, b` triples (`--color-base-accent-1: 18,18,18`).
 */
export function parseColorValue(raw: string): string | null {
  const value = raw.trim().replace(/;$/, "").trim();
  if (!value) return null;

  const hex6 = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex6) return `#${hex6[1].toLowerCase()}`;

  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`.toLowerCase();

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    // A nearly transparent colour is not a brand colour, it is a scrim.
    if (!Number.isFinite(alpha) || alpha < 0.5) return null;
    return toHex([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]);
  }

  const triple = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(value);
  if (triple) {
    const parts = [Number(triple[1]), Number(triple[2]), Number(triple[3])] as [number, number, number];
    if (parts.some((c) => c > 255)) return null;
    return toHex(parts);
  }

  return null;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** HSV saturation, 0 (grey) to 1. Mirrors appearance.shared.ts's own chroma measure. */
function chromaOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * Pulls `--custom-property: <colour>` declarations out of a storefront document.
 *
 * Deliberately limited to custom properties rather than every declaration in the page: theme
 * authors name the colours that define a brand, and parsing arbitrary `color:`/`background:`
 * rules drags in hundreds of incidental greys with no way to tell them apart.
 */
export function extractStorePalette(html: string): StorePalette {
  const empty: StorePalette = { accent: null, background: null, candidates: [] };
  if (!html) return empty;

  // A password-protected storefront serves a Shopify-branded gate, not the merchant's design.
  // Reading its palette would hand back Shopify's colours as if they were the merchant's.
  if (/<form[^>]+action="\/password"/i.test(html) || /id="password_dialog"/i.test(html)) {
    return empty;
  }

  const scored = new Map<string, number>();
  let background: string | null = null;
  let backgroundScore = -1;

  const declaration = /--([a-z0-9-]+)\s*:\s*([^;{}"']+)[;}]/gi;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(html)) !== null) {
    const name = match[1].toLowerCase();
    const color = parseColorValue(match[2]);
    if (!color) continue;

    const bgIndex = BACKGROUND_NAMES.indexOf(name);
    if (bgIndex !== -1 && backgroundScore < BACKGROUND_NAMES.length - bgIndex) {
      background = color;
      backgroundScore = BACKGROUND_NAMES.length - bgIndex;
    }

    if (EXCLUDED_NAME_PARTS.some((part) => name.includes(part))) continue;

    // Only chromatic colours can be a brand accent; greys are structure.
    if (chromaOf(color) < 0.2) continue;

    const hintIndex = BRAND_NAME_HINTS.findIndex((hint) => name.includes(hint));
    // Only colours a theme actually NAMED as brand-ish are offered. An earlier version also
    // accepted any chromatic value at a lower score, which on a real storefront surfaced a
    // rainbow of semantic status colours and buried the one that mattered.
    if (hintIndex === -1) continue;
    const score = BRAND_NAME_HINTS.length - hintIndex;
    scored.set(color, Math.max(scored.get(color) ?? 0, score));
  }

  const candidates = [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([color]) => color);

  return { accent: candidates[0] ?? null, background, candidates: candidates.slice(0, 8) };
}

/** True when the storefront reads as a dark design, so a suggestion can account for it. */
export function isDarkBackground(background: string | null): boolean {
  if (!background) return false;
  const againstWhite = contrastRatio(background, "#ffffff");
  return againstWhite !== null && againstWhite > 4.5;
}

/**
 * Fetches a storefront and reads its palette. Returns null on any failure — a suggestion
 * without store context is still useful; a suggestion built on a timeout is not.
 */
export async function getStorePalette(shopDomain: string): Promise<StorePalette | null> {
  const domain = shopDomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return null;

  try {
    const response = await fetch(`https://${domain}/`, {
      redirect: "follow",
      headers: { "User-Agent": "ImagynReviews/1.0 (+https://app.imagyn.co)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const body = await response.text();
    const palette = extractStorePalette(body.slice(0, MAX_BYTES));
    return palette.candidates.length > 0 || palette.background ? palette : null;
  } catch {
    return null;
  }
}
