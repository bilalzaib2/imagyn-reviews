import prisma from "../db.server";
import {
  getDefaultWidgetSettings,
  normalizeWidgetType,
  type WidgetSettings,
  type WidgetType,
} from "./widget.shared";

export interface WidgetRecord {
  id: string;
  storeId: string;
  productId: string | null;
  name: string;
  type: WidgetType;
  settings: WidgetSettings;
  createdAt: Date;
  updatedAt: Date;
}

export { getDefaultWidgetSettings } from "./widget.shared";

const parseSettings = (type: WidgetType, rawSettings: string | null): WidgetSettings => {
  const defaults = getDefaultWidgetSettings(type);

  if (!rawSettings) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(rawSettings) as Partial<WidgetSettings>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
};

const toWidgetRecord = (widget: {
  id: string;
  storeId: string;
  productId: string | null;
  name: string;
  type: string;
  settings: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WidgetRecord => {
  const type = normalizeWidgetType(widget.type);
  return {
    id: widget.id,
    storeId: widget.storeId,
    productId: widget.productId,
    name: widget.name,
    type,
    settings: parseSettings(type, widget.settings),
    createdAt: widget.createdAt,
    updatedAt: widget.updatedAt,
  };
};

// Every mutation below requires the caller's own storeId and verifies the target widget
// actually belongs to it before touching anything — a store must never be able to read,
// edit, duplicate, reset, or delete another store's widget by guessing/reusing an id. Thrown
// as the same generic "not found" a genuinely-missing id would produce, so a cross-tenant
// attempt can't distinguish "doesn't exist" from "exists, but isn't yours".
const NOT_FOUND_ERROR = "Widget not found.";

const findOwnedWidgetOrThrow = async (storeId: string, id: string) => {
  const existing = await prisma.widget.findUnique({ where: { id } });
  if (!existing || existing.storeId !== storeId) {
    throw new Error(NOT_FOUND_ERROR);
  }
  return existing;
};

export const widgetService = {
  async listWidgets(storeId: string, productId?: string) {
    const widgets = await prisma.widget.findMany({
      where: {
        storeId,
        ...(productId ? { productId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return widgets.map(toWidgetRecord);
  },

  async getWidget(storeId: string, id: string) {
    const widget = await findOwnedWidgetOrThrow(storeId, id).catch(() => null);
    return widget ? toWidgetRecord(widget) : null;
  },

  async createWidget(data: {
    storeId: string;
    productId?: string | null;
    name: string;
    type: WidgetType;
    settings: WidgetSettings;
  }) {
    const widget = await prisma.widget.create({
      data: {
        storeId: data.storeId,
        productId: data.productId ?? null,
        name: data.name.trim(),
        type: data.type,
        settings: JSON.stringify(data.settings),
      },
    });

    return toWidgetRecord(widget);
  },

  async updateWidget(storeId: string, id: string, data: {
    productId?: string | null;
    name?: string;
    type?: WidgetType;
    settings?: WidgetSettings;
  }) {
    await findOwnedWidgetOrThrow(storeId, id);

    const widget = await prisma.widget.update({
      where: { id },
      data: {
        ...(data.productId !== undefined ? { productId: data.productId } : {}),
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.settings !== undefined ? { settings: JSON.stringify(data.settings) } : {}),
      },
    });

    return toWidgetRecord(widget);
  },

  async duplicateWidget(storeId: string, id: string) {
    const existing = await findOwnedWidgetOrThrow(storeId, id);

    const duplicate = await prisma.widget.create({
      data: {
        storeId: existing.storeId,
        productId: existing.productId,
        name: `${existing.name} Copy`,
        type: existing.type,
        settings: existing.settings,
      },
    });

    return toWidgetRecord(duplicate);
  },

  async deleteWidget(storeId: string, id: string) {
    await findOwnedWidgetOrThrow(storeId, id);
    await prisma.widget.delete({ where: { id } });
  },

  async resetWidget(storeId: string, id: string) {
    const existing = await findOwnedWidgetOrThrow(storeId, id);

    const type = normalizeWidgetType(existing.type);
    const defaultSettings = getDefaultWidgetSettings(type);
    const widget = await prisma.widget.update({
      where: { id },
      data: {
        settings: JSON.stringify(defaultSettings),
      },
    });

    return toWidgetRecord(widget);
  },
};

// Resolution order for public/storefront rendering: an enabled widget scoped to this
// specific product, then an enabled store-wide widget (productId null) of the same type,
// then the built-in defaults. Reuses listWidgets/getDefaultWidgetSettings rather than
// re-querying or re-parsing settings.
//
// `canUseAdvancedLayout` (Pro-only — see permissions.ts's canUseMultipleWidgetThemes) coerces
// `layout` back to "list" for a non-Pro store, regardless of what's saved. This exists because
// the Grid/Carousel layout choice is actually a *native Shopify Theme Editor block setting*
// (see star_rating.liquid's own `layout` schema field, applied client-side by
// reviews-widget.js's readThemeOverrides) — our app has no server-side control over whether
// Shopify renders that setting into the block's HTML, so this coercion (echoed again by the
// storefront API — see api.reviews.tsx) is the actual enforcement point, not a UI-hiding trick.
export async function getStorefrontWidgetSettings(
  storeId: string,
  productId: string,
  type: WidgetType = "review-list",
  canUseAdvancedLayout = true,
): Promise<{ type: WidgetType; settings: WidgetSettings }> {
  const productScoped = await widgetService.listWidgets(storeId, productId);
  const productMatch = productScoped.find((widget) => widget.type === type && widget.settings.enabled);

  const resolved = productMatch
    ? { type: productMatch.type, settings: productMatch.settings }
    : await (async () => {
        const storeScoped = await widgetService.listWidgets(storeId);
        const storeMatch = storeScoped.find(
          (widget) => widget.type === type && widget.productId === null && widget.settings.enabled,
        );

        return storeMatch
          ? { type: storeMatch.type, settings: storeMatch.settings }
          : { type, settings: getDefaultWidgetSettings(type) };
      })();

  if (!canUseAdvancedLayout && resolved.settings.layout && resolved.settings.layout !== "list") {
    return { ...resolved, settings: { ...resolved.settings, layout: "list" } };
  }

  return resolved;
}

// Store-wide counterpart of getStorefrontWidgetSettings above, for widgets that have no
// "current product" context (the Review Carousel is placed once, typically on the homepage,
// not per-product) — reuses the same store-wide-match branch rather than routing through the
// product-scoped resolution that doesn't apply here. `type` defaults to "review-carousel"
// since that's the only widget this is used for today, but isn't hardcoded to it.
export async function getStorefrontCarouselSettings(
  storeId: string,
  type: WidgetType = "review-carousel",
): Promise<WidgetSettings> {
  const storeScoped = await widgetService.listWidgets(storeId);
  const match = storeScoped.find(
    (widget) => widget.type === type && widget.productId === null && widget.settings.enabled,
  );

  return match ? match.settings : getDefaultWidgetSettings(type);
}
