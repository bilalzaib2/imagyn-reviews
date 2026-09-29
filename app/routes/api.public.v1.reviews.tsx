import type { LoaderFunctionArgs } from "react-router";
import { listPublicReviews, type ReviewSort } from "../services/publicDiscovery.server";
import { assertGet, publicJson, readBool, readInt, readString } from "./api.public.v1";

const SORTS: ReviewSort[] = ["latest", "helpful", "highest", "lowest"];

// GET /api/public/v1/reviews — the consumer network's primary discovery feed.
// Filters: verified, withPhotos, withVideo, rating, category, store, product.
// Sort: latest | helpful | highest | lowest. Cursor-paginated.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const url = new URL(request.url);
  const sortParam = readString(url, "sort");
  const sort = SORTS.includes(sortParam as ReviewSort) ? (sortParam as ReviewSort) : "latest";

  const page = await listPublicReviews({
    verifiedOnly: readBool(url, "verified"),
    withPhotos: readBool(url, "withPhotos"),
    withVideo: readBool(url, "withVideo"),
    rating: readInt(url, "rating"),
    category: readString(url, "category"),
    store: readString(url, "store"),
    product: readString(url, "product"),
    sort,
    cursor: readString(url, "cursor") ?? null,
    limit: readInt(url, "limit"),
  });

  return publicJson({ ok: true, sort, ...page });
};
