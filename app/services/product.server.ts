import prisma from "../db.server";
import { getOrCreateStore } from "./store.server";

export async function getShopifyProducts(admin: any) {
  const response = await admin.graphql(`
    #graphql
    query GetProducts {
      products(first: 100) {
        nodes {
          id
          title
          handle
          vendor
          productType
          status
          description
          featuredImage {
            url
          }
        }
      }
    }
  `);

  const json = await response.json();

  if (json.errors) {
    console.error(json.errors);
    return [];
  }

  return json.data.products.nodes;
}

export async function syncProducts(admin: any, shop: string) {
  const store = await getOrCreateStore(shop);

  const products = await getShopifyProducts(admin);

  for (const product of products) {
    await prisma.product.upsert({
      where: {
        shopifyProductId: product.id,
      },
      update: {
        name: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        status: product.status,
        featuredImage: product.featuredImage?.url ?? null,
        description: product.description,
        slug: product.handle,
      },
      create: {
        storeId: store.id,
        shopifyProductId: product.id,
        name: product.title,
        handle: product.handle,
        vendor: product.vendor,
        productType: product.productType,
        status: product.status,
        featuredImage: product.featuredImage?.url ?? null,
        description: product.description,
        slug: product.handle,
      },
    });
  }

  return prisma.product.findMany({
    where: {
      storeId: store.id,
    },
    orderBy: {
      name: "asc",
    },
  });
}

export async function getProducts(storeId: string) {
  return prisma.product.findMany({
    where: {
      storeId,
    },
    orderBy: {
      name: "asc",
    },
  });
}

export async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: {
      id,
    },
  });
}