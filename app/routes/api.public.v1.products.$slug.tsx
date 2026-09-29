import type { LoaderFunctionArgs } from "react-router";
import { getPublicProduct, listPublicReviews, listReviewedProducts } from "../services/publicDiscovery.server";
import { assertGet, publicError, publicJson, readString } from "./api.public.v1";

// GET /api/public/v1/products/:slug — product detail, its own review feed, and related
// reviewed products, in one round trip.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const slug = params.slug ?? "";
  const product = await getPublicProduct(slug);
  if (!product || product.reviewCount === 0) return publicError("Product not found.", 404);

  const url = new URL(request.url);
  const [reviews, related] = await Promise.all([
    listPublicReviews({ product: slug, sort: "helpful", cursor: readString(url, "cursor") ?? null }),
    product.category
      ? listReviewedProducts({ category: product.category, limit: 8 })
      : listReviewedProducts({ limit: 8 }),
  ]);

  return publicJson({
    ok: true,
    product,
    reviews,
    related: related.filter((p) => p.slug !== product.slug).slice(0, 6),
  });
};
