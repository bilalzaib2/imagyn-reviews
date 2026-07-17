import prisma from "../db.server";

export const reviewService = {
  async list(storeId?: string, productId?: string) {
    return prisma.review.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        ...(productId ? { productId } : {}),
      },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
  },

  async getById(id: string) {
    return prisma.review.findUnique({ where: { id } });
  },

  async create(data: {
    storeId: string;
    productId?: string | null;
    authorName?: string | null;
    title?: string | null;
    body?: string | null;
    rating?: number | null;
    status?: string;
  }) {
    return prisma.review.create({ data });
  },

  async update(id: string, data: {
    productId?: string | null;
    authorName?: string | null;
    title?: string | null;
    body?: string | null;
    rating?: number | null;
    status?: string;
  }) {
    return prisma.review.update({ where: { id }, data });
  },

  async remove(id: string) {
    return prisma.review.delete({ where: { id } });
  },
};
