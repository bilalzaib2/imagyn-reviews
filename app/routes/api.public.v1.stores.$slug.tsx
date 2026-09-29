import type { LoaderFunctionArgs } from "react-router";
import { getPublicStore, listPublicReviews, listReviewedProducts } from "../services/publicDiscovery.server";
import { assertGet, publicError, publicJson, readString } from "./api.public.v1";

// GET /api/public/v1/stores/:slug — store reputation page: rating breakdown, its reviewed
// products, and its review feed.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const slug = params.slug ?? "";
  const store = await getPublicStore(slug);
  if (!store) return publicError("Store not found.", 404);

  const url = new URL(request.url);
  const [reviews, products] = await Promise.all([
    listPublicReviews({ store: slug, sort: "latest", cursor: readString(url, "cursor") ?? null }),
    listReviewedProducts({ store: slug, limit: 12 }),
  ]);

  return publicJson({ ok: true, store, reviews, products });
};
