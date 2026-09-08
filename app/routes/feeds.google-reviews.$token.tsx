import type { LoaderFunctionArgs } from "react-router";
import { findStoreByFeedToken, generateFeedXml } from "../services/googleReviewFeed.server";

// Public, unauthenticated feed endpoint — the URL a merchant registers directly in Google
// Merchant Center (or fetches themselves to preview/download). Token-gated, not storeId-gated,
// so the URL can't be enumerated (see Store.googleFeedToken's schema comment). Returns a
// real, empty-but-valid feed for a disabled/unknown token rather than a 404 — Google's own
// scheduled fetcher treats a 404 as a persistent feed error, whereas an empty feed is a
// normal, recoverable "nothing to show yet" state.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token;
  const store = token ? await findStoreByFeedToken(token) : null;

  if (!store || !store.domain) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<feed>\n<reviews>\n</reviews>\n</feed>\n`, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  const xml = await generateFeedXml(store.id, store.domain);

  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
