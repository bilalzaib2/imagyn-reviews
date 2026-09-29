import type { LoaderFunctionArgs } from "react-router";
import {
  getDiscoveryFacets,
  getNetworkStats,
  listPublicReviews,
  listPublicStores,
  listReviewedProducts,
} from "../services/publicDiscovery.server";
import { assertGet, publicJson } from "./api.public.v1";

// GET /api/public/v1/discover — everything the homepage needs in one round trip: live network
// stats for the discovery statement, the facets that actually have content behind them, the
// opening page of the review feed, and the reviewed products/stores.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const guard = assertGet(request);
  if (guard) return guard;

  const [stats, facets, reviews, products, stores] = await Promise.all([
    getNetworkStats(),
    getDiscoveryFacets(),
    listPublicReviews({ sort: "latest", limit: 24 }),
    listReviewedProducts({ limit: 12 }),
    listPublicStores(12),
  ]);

  return publicJson({ ok: true, stats, facets, reviews, products, stores });
};
