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

const resolveStoreId = async () => {
  const firstStore = await prisma.store.findFirst({ select: { id: true } });
  if (!firstStore) {
    throw new Error("No store is available for widget configuration.");
  }
  return firstStore.id;
};

export const widgetService = {
  async listWidgets(storeId?: string, productId?: string) {
    const widgets = await prisma.widget.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        ...(productId ? { productId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return widgets.map(toWidgetRecord);
  },

  async getWidget(id: string) {
    const widget = await prisma.widget.findUnique({ where: { id } });
    return widget ? toWidgetRecord(widget) : null;
  },

  async createWidget(data: {
    storeId?: string;
    productId?: string | null;
    name: string;
    type: WidgetType;
    settings: WidgetSettings;
  }) {
    const storeId = data.storeId ?? (await resolveStoreId());

    const widget = await prisma.widget.create({
      data: {
        storeId,
        productId: data.productId ?? null,
        name: data.name.trim(),
        type: data.type,
        settings: JSON.stringify(data.settings),
      },
    });

    return toWidgetRecord(widget);
  },

  async updateWidget(id: string, data: {
    productId?: string | null;
    name?: string;
    type?: WidgetType;
    settings?: WidgetSettings;
  }) {
    const existing = await prisma.widget.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Widget not found.");
    }

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

  async duplicateWidget(id: string) {
    const existing = await prisma.widget.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Widget not found.");
    }

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

  async deleteWidget(id: string) {
    const existing = await prisma.widget.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Widget not found.");
    }

    await prisma.widget.delete({ where: { id } });
  },

  async resetWidget(id: string) {
    const existing = await prisma.widget.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Widget not found.");
    }

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
