import prisma from "../db.server";

export const productService = {
  async list(storeId?: string) {
    return prisma.product.findMany({
      where: storeId ? { storeId } : undefined,
    });
  },

  async getById(id: string) {
    return prisma.product.findUnique({ where: { id } });
  },

  async create(data: { storeId: string; name: string; slug?: string | null; description?: string | null }) {
    return prisma.product.create({ data });
  },

  async update(id: string, data: { name?: string; slug?: string | null; description?: string | null }) {
    return prisma.product.update({ where: { id }, data });
  },

  async remove(id: string) {
    return prisma.product.delete({ where: { id } });
  },
};
