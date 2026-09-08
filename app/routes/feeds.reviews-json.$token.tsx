import type { LoaderFunctionArgs } from "react-router";
import { findStoreByFeedToken, generateDistributionFeedJson } from "../services/googleReviewFeed.server";

// Public, unauthenticated JSON counterpart to feeds.google-reviews.$token.tsx — same token
// (Store.googleFeedToken), same enabled flag, same eligible-review set, just a shape any
// distribution channel other than Google Merchant Center can consume directly. Returns a real,
// empty-but-valid feed for a disabled/unknown token rather than a 404, for the same reason as
// the XML feed: a scheduled fetcher should see "nothing to show yet," not a persistent error.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token;
  const store = token ? await findStoreByFeedToken(token) : null;

  if (!store || !store.domain) {
    return new Response(JSON.stringify({ store: null, generatedAt: new Date().toISOString(), reviews: [] }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const json = await generateDistributionFeedJson(store.id, store.domain);

  return new Response(json, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
