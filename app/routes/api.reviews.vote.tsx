import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HelpfulVoteValue, castHelpfulVote } from "../services/review.server";
import { getStoreBySlug } from "../services/store.server";
import { checkAndRecordSubmission } from "../services/reviewSubmissionThrottle.server";
import { json, isPreflight, preflightResponse, storeSlugFromShop } from "./api.reviews";

// Public, unauthenticated write for the storefront widget's "Was this helpful?" control.
// GET is unsupported on purpose — this endpoint only ever mutates a vote; the reviews
// list endpoint (api.reviews.tsx) is what returns the visitor's existing votes on load.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  return json({ ok: false, error: "Method not allowed." }, { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (isPreflight(request)) {
    return preflightResponse();
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  // Throws a 400 Response when the request wasn't genuinely forwarded by Shopify's App
  // Proxy (missing/invalid signature) — this is what actually rejects non-Shopify traffic.
  await authenticate.public.appProxy(request);

  // `shop` is one of the query params covered by the signature just verified above, so it is a
  // trusted value — the same reasoning api.reviews.tsx's own loader/action documents.
  //
  // Resolving it is NOT optional. A valid App Proxy signature only proves "some shop with this
  // app installed forwarded this request"; it says nothing about which shop's reviews the body
  // refers to. Without scoping the vote to this shop's store, any installer could vote on any
  // review on the platform, and review ids are freely enumerable from the public consumer API
  // (api.public.v1.reviews.tsx returns them unauthenticated). See castHelpfulVote's own header.
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop")?.trim() || "";

  if (!shop) {
    return json({ ok: false, error: "shop is required." }, { status: 400 });
  }

  const store = await getStoreBySlug(storeSlugFromShop(shop));

  if (!store) {
    return json({ ok: false, error: "Shop not found." }, { status: 404 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const reviewId = typeof payload.reviewId === "string" ? payload.reviewId.trim() : "";
  const visitorId = typeof payload.visitorId === "string" ? payload.visitorId.trim() : "";
  const voteValue = typeof payload.vote === "string" ? payload.vote.trim().toUpperCase() : "";

  const errors: string[] = [];
  if (!reviewId) errors.push("Review ID is required.");
  if (!visitorId) errors.push("A visitor identifier is required.");
  if (voteValue !== HelpfulVoteValue.HELPFUL && voteValue !== HelpfulVoteValue.NOT_HELPFUL) {
    errors.push('Vote must be "helpful" or "not_helpful".');
  }

  if (errors.length > 0) {
    return json({ ok: false, error: errors.join(" ") }, { status: 400 });
  }

  // `visitorId` is client-generated and entirely unverifiable, so the per-visitor uniqueness
  // constraint alone can't bound abuse — rotating it mints a fresh vote every time. This is the
  // same IP-bucketed defense the two submission endpoints already use, on its own "vote" scope
  // with a much higher ceiling, so a shopper marking a page full of reviews helpful is never
  // mistaken for a script (see reviewSubmissionThrottle.server.ts's MAX_VOTES_PER_WINDOW).
  const throttle = await checkAndRecordSubmission(store.id, request, "vote");
  if (!throttle.allowed) {
    return json(
      { ok: false, error: "Too many votes from this connection. Please try again later." },
      { status: 429 },
    );
  }

  try {
    const result = await castHelpfulVote(store.id, reviewId, visitorId, voteValue as HelpfulVoteValue);
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to record vote." },
      { status: 400 },
    );
  }
};
