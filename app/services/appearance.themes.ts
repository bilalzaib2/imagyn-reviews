// Pre-built themes — complete, ready-made looks a merchant can apply in one click.
//
// Distinct from appearance.presets.ts on purpose, and the difference is the whole point:
//
//   * A Widget Style PRESET carries structure only (typography, spacing, corners, borders,
//     buttons, card treatment). It deliberately never touches `colors`, so a merchant who
//     has already chosen their accent can restyle the layout without losing it.
//   * A THEME here is a finished look INCLUDING its palette. Picking one is meant to be the
//     shortest path from "my widgets look wrong" to "my widgets look good".
//
// What a theme deliberately does NOT set:
//   * images  — the logo is the merchant's own identity, not a styling choice. Applying a
//               theme must never silently drop a logo they uploaded.
//   * layout  — max content width is a layout constraint of their theme, not an aesthetic.
// mergeAppearanceTokens shallow-merges per category, so omitting those categories preserves
// whatever the merchant already has.
//
// Every palette here is covered by appearance.themes.test.ts, which asserts each one passes
// checkStarLegibility and clears WCAG AA for text on its own surface. A theme that ships an
// unreadable rating is the exact failure the AI brand suggestion already produced once
// (a live store was handed #B0B0B0 stars) — a curated list must not reintroduce it.
import type { AppearancePreset, AppearanceTokens } from "./appearance.shared";

export interface AppearanceThemeDefinition {
  id: AppearancePreset;
  label: string;
  description: string;
  /** Partial by design — see the header note on images/layout. */
  tokens: Partial<AppearanceTokens>;
}

export const appearanceThemes: AppearanceThemeDefinition[] = [
  {
    id: "amber",
    label: "Amber",
    description: "The familiar review look — warm gold stars on white, softly rounded.",
    tokens: {
      typography: { scale: 1, letterSpacing: "tight", fontFamily: null },
      colors: {
        textColor: "#1a1a1a",
        starColor: "#f5a623",
        starEmptyColor: "rgba(0, 0, 0, 0.15)",
        borderColor: "rgba(0, 0, 0, 0.1)",
        surfaceColor: "#ffffff",
      },
      spacing: { density: "balanced" },
      corners: { radius: 10 },
      borders: { width: 1 },
      buttons: { style: "solid" },
      reviewCards: { separator: "border" },
      cards: { shadowIntensity: "none" },
    },
  },
  {
    id: "ink",
    label: "Ink",
    description: "Monochrome and typographic — no colour at all, just hierarchy.",
    tokens: {
      typography: { scale: 1, letterSpacing: "tight", fontFamily: null },
      colors: {
        textColor: "#1a1a1a",
        starColor: "#1a1a1a",
        starEmptyColor: "rgba(0, 0, 0, 0.15)",
        borderColor: "rgba(0, 0, 0, 0.12)",
        surfaceColor: "#ffffff",
      },
      spacing: { density: "balanced" },
      corners: { radius: 4 },
      borders: { width: 1 },
      buttons: { style: "solid" },
      reviewCards: { separator: "border" },
      cards: { shadowIntensity: "none" },
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "A dark card with warm stars — for stores on a dark background.",
    tokens: {
      typography: { scale: 1, letterSpacing: "tight", fontFamily: null },
      colors: {
        textColor: "#f4f4f5",
        starColor: "#f5b544",
        // The light-on-dark counterpart: the default translucent-BLACK unfilled star would
        // composite to near-black here and vanish against the card.
        starEmptyColor: "rgba(255, 255, 255, 0.22)",
        borderColor: "rgba(255, 255, 255, 0.14)",
        surfaceColor: "#101014",
      },
      spacing: { density: "balanced" },
      corners: { radius: 12 },
      borders: { width: 1 },
      buttons: { style: "solid" },
      reviewCards: { separator: "boxed" },
      cards: { shadowIntensity: "none" },
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Deep green on white — calm and natural, good for wellness and food.",
    tokens: {
      typography: { scale: 1, letterSpacing: "normal", fontFamily: null },
      colors: {
        textColor: "#13251f",
        starColor: "#1f7a5a",
        starEmptyColor: "rgba(0, 0, 0, 0.15)",
        borderColor: "rgba(19, 37, 31, 0.12)",
        surfaceColor: "#ffffff",
      },
      spacing: { density: "spacious" },
      corners: { radius: 8 },
      borders: { width: 1 },
      buttons: { style: "outline" },
      reviewCards: { separator: "border" },
      cards: { shadowIntensity: "none" },
    },
  },
  {
    id: "rose",
    label: "Rose",
    description: "A warm boutique look — deep rose accents on a soft off-white.",
    tokens: {
      typography: { scale: 1.05, letterSpacing: "normal", fontFamily: null },
      colors: {
        textColor: "#2a1119",
        starColor: "#c2185b",
        starEmptyColor: "rgba(0, 0, 0, 0.15)",
        borderColor: "rgba(42, 17, 25, 0.12)",
        surfaceColor: "#fffafb",
      },
      spacing: { density: "spacious" },
      corners: { radius: 14 },
      borders: { width: 1 },
      buttons: { style: "solid" },
      reviewCards: { separator: "boxed" },
      cards: { shadowIntensity: "subtle" },
    },
  },
];
