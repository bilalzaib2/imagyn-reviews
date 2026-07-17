import prisma from "../db.server";

export const widgetService = {
  async list(storeId?: string, productId?: string) {
    return prisma.widget.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        ...(productId ? { productId } : {}),
      },
    });
  },

  async getById(id: string) {
    return prisma.widget.findUnique({ where: { id } });
  },

  async create(data: { storeId: string; productId?: string | null; name: string; type?: string; settings?: string | null }) {
    return prisma.widget.create({ data });
  },

  async update(id: string, data: { productId?: string | null; name?: string; type?: string; settings?: string | null }) {
    return prisma.widget.update({ where: { id }, data });
  },

  async remove(id: string) {
    return prisma.widget.delete({ where: { id } });
  },
};
