// Imagyn Reviews — structured-data sync (the Shopify-metafield delivery adapter).
//
// This is the one piece of the structured-data engine that's Shopify-specific — it reads
// our own DB via the same public-safe queries the storefront API already uses, builds the
// JSON-LD via the reusable composer (index.server.ts), and writes it to a product
// metafield so extensions/imagyn-review-widgets/blocks/star_rating.liquid can render it
// server-side with zero extra request. A future public platform page would call
// buildProductStructuredData directly instead of this file — see index.server.ts's
// header comment.
//
// Namespace is the literal string "$app" (verified against shopify.dev, not "app") —
// this is what shopify.app.toml's [product.metafields.app.reviews_jsonld] declaration
// actually maps to over the Admin GraphQL API.

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { getProduct } from "../product.server";
import { getPublicReviewSummary, getProductReviews, ReviewStatus } from "../review.server";
import { buildProductStructuredData } from "./index.server";
import { MAX_REVIEWS_IN_SCHEMA } from "./builders/reviewSchema.server";

const NAMESPACE = "$app";
const KEY = "reviews_jsonld";

const METAFIELDS_SET = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface MetafieldsSetResponse {
  data?: {
    metafieldsSet: {
      metafields: Array<{ id: string }>;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
}

async function writeMetafield(admin: AdminApiContext, shopifyProductId: string, value: string) {
  const response = await admin.graphql(METAFIELDS_SET, {
    variables: {
      metafields: [
        {
          ownerId: shopifyProductId,
          namespace: NAMESPACE,
          key: KEY,
          type: "json",
          value,
        },
      ],
    },
  });
  const json = (await response.json()) as MetafieldsSetResponse;

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((error) => error.message).join(" "));
  }

  const userErrors = json.data?.metafieldsSet.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(userErrors.map((error) => error.message).join(" "));
  }
}

export type StructuredDataSyncStatus = "written" | "cleared" | "skipped-no-shopify-id" | "skipped-error";

// Never throws — a Shopify API hiccup here must never turn an otherwise-successful review
// mutation (approve/reject/delete/edit) into a user-facing error. Callers can inspect the
// returned status if they care, but none are required to.
export async function syncProductStructuredData(
  admin: AdminApiContext,
  productId: string,
): Promise<StructuredDataSyncStatus> {
  const product = await getProduct(productId);

  if (!product?.shopifyProductId) {
    return "skipped-no-shopify-id";
  }

  const [summary, { reviews }] = await Promise.all([
    getPublicReviewSummary(productId),
    getProductReviews(productId, { status: ReviewStatus.APPROVED, limit: MAX_REVIEWS_IN_SCHEMA }),
  ]);

  const jsonLd = buildProductStructuredData(
    { name: product.name, featuredImage: product.featuredImage },
    summary,
    reviews,
  );

  // A cleared (null) value still gets written explicitly — a product that drops to zero
  // approved reviews (e.g. the last one rejected) must stop rendering stale markup, not
  // keep serving whatever was last synced.
  const value = JSON.stringify(jsonLd ? { "@context": "https://schema.org", ...jsonLd } : null);

  try {
    await writeMetafield(admin, product.shopifyProductId, value);
    return jsonLd ? "written" : "cleared";
  } catch (error) {
    console.error(`Failed to sync structured data for product ${productId}:`, error);
    return "skipped-error";
  }
}
