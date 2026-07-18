import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { Product } from "@prisma/client";
import prisma from "../db.server";
import { getOrCreateStore } from "./store.server";

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  description: string | null;
  featuredImage: { url: string } | null;
}

interface ProductsQueryResponse {
  data?: {
    products: {
      nodes: ShopifyProductNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

export interface ProductSyncResult {
  products: Product[];
  totalCount: number;
  syncedCount: number;
  failedCount: number;
}

const PRODUCTS_QUERY = `#graphql
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
`;

export async function getShopifyProducts(admin: AdminApiContext): Promise<ShopifyProductNode[]> {
  const response = await admin.graphql(PRODUCTS_QUERY);
  const json = (await response.json()) as ProductsQueryResponse;

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join(" "));
  }

  if (!json.data) {
    throw new Error("Shopify did not return any product data.");
  }

  return json.data.products.nodes;
}

export async function syncProducts(admin: AdminApiContext, shop: string): Promise<ProductSyncResult> {
  const store = await getOrCreateStore(shop);
  const products = await getShopifyProducts(admin);

  let syncedCount = 0;
  let failedCount = 0;

  for (const product of products) {
    if (!product.id) {
      failedCount += 1;
      continue;
    }

    try {
      await prisma.product.upsert({
        where: {
          shopifyProductId: product.id,
        },
        update: {
          storeId: store.id,
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
      syncedCount += 1;
    } catch (error) {
      failedCount += 1;
      console.error(`Failed to sync Shopify product ${product.id}:`, error);
    }
  }

  return {
    products: await getProducts(store.id),
    totalCount: products.length,
    syncedCount,
    failedCount,
  };
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
