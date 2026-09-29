import type { LoaderFunctionArgs } from "react-router";
import { getPublicReview, listPublicReviews } from "../services/publicDiscovery.server";
import { assertGet, publicError, publicJson } from "./api.public.v1";

// GET /api/public/v1/reviews/:id — one review plus a few more for the same product, so the
// detail page can offer a real next step instead of dead-ending.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const review = await getPublicReview(params.id ?? "");
  if (!review) return publicError("Review not found.", 404);

  const related = await listPublicReviews({ product: review.product.slug, limit: 6, sort: "helpful" });

  return publicJson({
    ok: true,
    review,
    related: related.reviews.filter((r) => r.id !== review.id).slice(0, 4),
  });
};
