import prisma from "../db.server";

export const reviewRequestService = {
  async list(storeId?: string, productId?: string) {
    return prisma.reviewRequest.findMany({
      where: {
        ...(storeId ? { storeId } : {}),
        ...(productId ? { productId } : {}),
      },
      include: {
        store: true,
        product: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async getById(id: string) {
    return prisma.reviewRequest.findUnique({ where: { id } });
  },

  async create(data: {
    storeId: string;
    productId?: string | null;
    email?: string | null;
    name?: string | null;
    requestToken?: string | null;
    status?: string;
  }) {
    return prisma.reviewRequest.create({ data });
  },

  async update(id: string, data: {
    productId?: string | null;
    email?: string | null;
    name?: string | null;
    requestToken?: string | null;
    status?: string;
  }) {
    return prisma.reviewRequest.update({ where: { id }, data });
  },

  async remove(id: string) {
    return prisma.reviewRequest.delete({ where: { id } });
  },
};
