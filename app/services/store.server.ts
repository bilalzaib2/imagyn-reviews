import prisma from "../db.server";

function getShopName(shop: string) {
  return shop
    .replace(".myshopify.com", "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSlug(shop: string) {
  return shop.replace(".myshopify.com", "");
}

export async function getOrCreateStore(shop: string) {
  const slug = getSlug(shop);

  return prisma.store.upsert({
    where: {
      slug,
    },
    update: {
      domain: shop,
    },
    create: {
      name: getShopName(shop),
      slug,
      domain: shop,
    },
  });
}

export async function getStoreById(id: string) {
  return prisma.store.findUnique({
    where: {
      id,
    },
  });
}

export async function getStoreBySlug(slug: string) {
  return prisma.store.findUnique({
    where: {
      slug,
    },
  });
}

export async function updateStore(
  id: string,
  data: {
    name?: string;
    domain?: string | null;
  },
) {
  return prisma.store.update({
    where: {
      id,
    },
    data,
  });
}

export async function deleteStore(id: string) {
  return prisma.store.delete({
    where: {
      id,
    },
  });
}
