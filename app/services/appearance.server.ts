// Imagyn Reviews — Appearance System service layer.
//
// Same shape as widget.server.ts (parseSettings/toWidgetRecord/getStorefrontWidgetSettings)
// — this file reuses that pattern, not any widget-specific logic. Appearance has no
// product scope (it's deliberately store-wide, see appearance.shared.ts), so resolution
// is a single level: the store's active row, or documented defaults.

import prisma from "../db.server";
import {
  getDefaultAppearanceTokens,
  mergeAppearanceTokens,
  type AppearancePreset,
  type AppearanceTokens,
} from "./appearance.shared";

export interface AppearanceRecord {
  id: string;
  storeId: string;
  name: string;
  preset: AppearancePreset;
  isActive: boolean;
  tokens: AppearanceTokens;
  createdAt: Date;
  updatedAt: Date;
}

const normalizePreset = (preset: string): AppearancePreset => {
  const candidates: AppearancePreset[] = ["minimal", "modern", "editorial", "classic", "custom"];
  return (candidates as string[]).includes(preset) ? (preset as AppearancePreset) : "custom";
};

const parseTokens = (raw: string | null): AppearanceTokens => {
  if (!raw) {
    return getDefaultAppearanceTokens();
  }

  try {
    return mergeAppearanceTokens(JSON.parse(raw) as Partial<AppearanceTokens>);
  } catch {
    return getDefaultAppearanceTokens();
  }
};

const toAppearanceRecord = (row: {
  id: string;
  storeId: string;
  name: string;
  preset: string;
  isActive: boolean;
  tokens: string;
  createdAt: Date;
  updatedAt: Date;
}): AppearanceRecord => ({
  id: row.id,
  storeId: row.storeId,
  name: row.name,
  preset: normalizePreset(row.preset),
  isActive: row.isActive,
  tokens: parseTokens(row.tokens),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const appearanceService = {
  async getActive(storeId: string): Promise<AppearanceRecord | null> {
    const row = await prisma.appearance.findFirst({
      where: { storeId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });

    return row ? toAppearanceRecord(row) : null;
  },

  // Upserts the store's one active Appearance row. `list`/`create`/`setActive` below are
  // intentionally not exposed by the v1 admin UI — they exist so a future "Saved
  // Presets" library is additive (more Appearance rows, isActive toggled) with no
  // service-layer change.
  async upsertActive(
    storeId: string,
    data: { tokens: AppearanceTokens; preset?: AppearancePreset; name?: string },
  ): Promise<AppearanceRecord> {
    const existing = await prisma.appearance.findFirst({ where: { storeId, isActive: true } });

    const row = existing
      ? await prisma.appearance.update({
          where: { id: existing.id },
          data: {
            tokens: JSON.stringify(data.tokens),
            ...(data.preset ? { preset: data.preset } : {}),
            ...(data.name !== undefined ? { name: data.name } : {}),
          },
        })
      : await prisma.appearance.create({
          data: {
            storeId,
            name: data.name ?? "Default",
            preset: data.preset ?? "custom",
            isActive: true,
            tokens: JSON.stringify(data.tokens),
          },
        });

    return toAppearanceRecord(row);
  },

  async list(storeId: string): Promise<AppearanceRecord[]> {
    const rows = await prisma.appearance.findMany({ where: { storeId }, orderBy: { updatedAt: "desc" } });
    return rows.map(toAppearanceRecord);
  },

  async create(storeId: string, data: { name: string; tokens: AppearanceTokens; preset?: AppearancePreset }): Promise<AppearanceRecord> {
    const row = await prisma.appearance.create({
      data: {
        storeId,
        name: data.name,
        preset: data.preset ?? "custom",
        isActive: false,
        tokens: JSON.stringify(data.tokens),
      },
    });
    return toAppearanceRecord(row);
  },

  // Exactly one isActive row per store — enforced here, not as a DB constraint (Postgres
  // partial unique indexes aren't a clean fit for Prisma's schema DSL, and
  // application-level enforcement already matches this codebase's convention — see
  // widgetService's own resolution order).
  async setActive(storeId: string, id: string): Promise<AppearanceRecord> {
    const [, activated] = await prisma.$transaction([
      prisma.appearance.updateMany({ where: { storeId, isActive: true }, data: { isActive: false } }),
      prisma.appearance.update({ where: { id }, data: { isActive: true } }),
    ]);
    return toAppearanceRecord(activated);
  },
};

// Reused by both public storefront endpoints (api.reviews.tsx, api.reviews.batch.tsx) so
// every widget resolves the exact same tokens the same way.
export async function getStorefrontAppearance(storeId: string): Promise<AppearanceTokens> {
  const active = await appearanceService.getActive(storeId);
  return active?.tokens ?? getDefaultAppearanceTokens();
}
