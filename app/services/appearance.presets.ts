// Imagyn Reviews — Appearance preset registry.
//
// Each preset is a Partial<AppearanceTokens> of structural categories only (typography
// scale/letter-spacing, spacing density, corners, borders, buttons, review-card
// separator, card shadow) — never `colors`. Accent Color is the merchant's own,
// independent choice (Appearance page's dedicated "Accent Color" section); switching
// Widget Style must never silently overwrite it. app.appearance.tsx's preset click
// handler applies this partial on top of the current draft via mergeAppearanceTokens(
// tokens, currentDraft), not on top of getDefaultAppearanceTokens(), for exactly this
// reason.

import { type AppearancePreset, type AppearanceTokens } from "./appearance.shared";

export interface AppearancePresetDefinition {
  id: AppearancePreset;
  label: string;
  description: string;
  available: boolean;
  tokens: Partial<AppearanceTokens> | null;
}

export const appearancePresets: AppearancePresetDefinition[] = [
  {
    id: "minimal",
    label: "Minimal",
    description: "Ornamentation removed — whitespace alone does the separating.",
    available: true,
    tokens: {
      typography: { scale: 0.97, letterSpacing: "normal", fontFamily: null },
      spacing: { density: "spacious" },
      corners: { radius: 4 },
      borders: { width: 0 },
      buttons: { style: "ghost" },
      reviewCards: { separator: "spacing" },
      cards: { shadowIntensity: "none" },
    },
  },
  {
    id: "modern",
    label: "Modern",
    description: "Bold type, boxed cards, a confident touch of elevation.",
    available: true,
    tokens: {
      typography: { scale: 1.05, letterSpacing: "tight", fontFamily: null },
      spacing: { density: "balanced" },
      corners: { radius: 14 },
      borders: { width: 1 },
      buttons: { style: "solid" },
      reviewCards: { separator: "boxed" },
      cards: { shadowIntensity: "subtle" },
    },
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "Magazine-inspired, generous whitespace, hairline dividers.",
    available: true,
    tokens: {
      typography: { scale: 1, letterSpacing: "tight", fontFamily: null },
      spacing: { density: "balanced" },
      corners: { radius: 8 },
      borders: { width: 1 },
      buttons: { style: "solid" },
      reviewCards: { separator: "border" },
      cards: { shadowIntensity: "none" },
    },
  },
  {
    id: "luxury",
    label: "Luxury",
    description: "Spacious, refined, quietly boxed with outline buttons.",
    available: true,
    tokens: {
      typography: { scale: 1.05, letterSpacing: "normal", fontFamily: null },
      spacing: { density: "spacious" },
      corners: { radius: 6 },
      borders: { width: 1 },
      buttons: { style: "outline" },
      reviewCards: { separator: "boxed" },
      cards: { shadowIntensity: "medium" },
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Your own configuration.",
    available: true,
    tokens: null,
  },
];

export const getAppearancePreset = (id: AppearancePreset): AppearancePresetDefinition =>
  appearancePresets.find((preset) => preset.id === id) ?? appearancePresets[0];
