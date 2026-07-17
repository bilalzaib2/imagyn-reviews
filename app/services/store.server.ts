import prisma from "../db.server";

export const storeService = {
  async list() {
    return prisma.store.findMany();
  },

  async getById(id: string) {
    return prisma.store.findUnique({ where: { id } });
  },

  async getBySlug(slug: string) {
    return prisma.store.findUnique({ where: { slug } });
  },

  async create(data: { name: string; slug: string; domain?: string | null }) {
    return prisma.store.create({ data });
  },

  async update(id: string, data: { name?: string; slug?: string; domain?: string | null }) {
    return prisma.store.update({ where: { id }, data });
  },

  async remove(id: string) {
    return prisma.store.delete({ where: { id } });
  },
};
