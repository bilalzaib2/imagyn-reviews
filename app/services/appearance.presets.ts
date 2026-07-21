// Imagyn Reviews — Appearance preset registry.
//
// "custom" is the only functional preset today (a merchant's own saved tokens). The
// other four are valid, storable AppearancePreset values with a real UI entry point
// (rendered inert, matching the existing "Coming soon" / data-reserved treatment already
// shipped in app.widgets.tsx's widgetCards gallery) so shipping a real preset later is
// just populating `tokens` and flipping `available: true` — no new mechanism, no schema
// change, no service change.

import { type AppearancePreset, type AppearanceTokens } from "./appearance.shared";

export interface AppearancePresetDefinition {
  id: AppearancePreset;
  label: string;
  description: string;
  available: boolean;
  tokens: AppearanceTokens | null;
}

export const appearancePresets: AppearancePresetDefinition[] = [
  {
    id: "custom",
    label: "Custom",
    description: "Your own configuration.",
    available: true,
    tokens: null,
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Understated, minimal ornamentation.",
    available: false,
    tokens: null,
  },
  {
    id: "modern",
    label: "Modern",
    description: "Bold type, confident color.",
    available: false,
    tokens: null,
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "Magazine-inspired, generous whitespace.",
    available: false,
    tokens: null,
  },
  {
    id: "classic",
    label: "Classic",
    description: "Traditional review styling.",
    available: false,
    tokens: null,
  },
];

export const getAppearancePreset = (id: AppearancePreset): AppearancePresetDefinition =>
  appearancePresets.find((preset) => preset.id === id) ?? appearancePresets[0];
