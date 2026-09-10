// Surface-Specific Override layer — the second tier of the Global Brand → Surface Default →
// Surface Override → Final Rendered Style hierarchy (see appearance.shared.ts's SurfaceKey
// and docs/DECISIONS.md's Global Brand System entry for the full architecture writeup).
//
// A merchant who has never touched a given surface's override has NO row here at all — that
// absence is what makes "reset to Brand Studio" a real, one-step operation (delete the row),
// and what makes a brand-new future surface need zero migration to inherit the global brand
// correctly on day one.

import prisma from "../db.server";
import { mergeAppearanceTokens, type AppearanceTokens, type SurfaceKey } from "./appearance.shared";

export async function getSurfaceOverrideTokens(storeId: string, surfaceKey: SurfaceKey): Promise<Partial<AppearanceTokens> | null> {
  const row = await prisma.surfaceBrandOverride.findUnique({
    where: { storeId_surfaceKey: { storeId, surfaceKey } },
  });
  if (!row) return null;

  try {
    return JSON.parse(row.tokens) as Partial<AppearanceTokens>;
  } catch {
    return null;
  }
}

export async function hasSurfaceOverride(storeId: string, surfaceKey: SurfaceKey): Promise<boolean> {
  const row = await prisma.surfaceBrandOverride.findUnique({
    where: { storeId_surfaceKey: { storeId, surfaceKey } },
    select: { id: true },
  });
  return row !== null;
}

// Upserts the one override row for this (store, surface) pair. `tokens` is a PARTIAL —
// only the categories the merchant actually changed for this surface — resolved against the
// global tokens at read time via resolveSurfaceTokens below, never stored pre-merged (so a
// later global brand change still shows through every field this surface never overrode).
export async function setSurfaceOverride(
  storeId: string,
  surfaceKey: SurfaceKey,
  tokens: Partial<AppearanceTokens>,
): Promise<void> {
  await prisma.surfaceBrandOverride.upsert({
    where: { storeId_surfaceKey: { storeId, surfaceKey } },
    create: { storeId, surfaceKey, tokens: JSON.stringify(tokens) },
    update: { tokens: JSON.stringify(tokens) },
  });
}

// "Reset to Brand Studio" — deletes the override row entirely (not a no-op update to empty
// tokens) so the surface immediately falls back to pure global inheritance with nothing left
// to accidentally resurrect later.
export async function resetSurfaceOverride(storeId: string, surfaceKey: SurfaceKey): Promise<void> {
  await prisma.surfaceBrandOverride.deleteMany({ where: { storeId, surfaceKey } });
}

// The one function every surface-aware backend route calls: real global tokens, merged with
// a real override if (and only if) the merchant has actually set one for this exact surface.
export function resolveSurfaceTokens(globalTokens: AppearanceTokens, override: Partial<AppearanceTokens> | null): AppearanceTokens {
  return override ? mergeAppearanceTokens(override, globalTokens) : globalTokens;
}
