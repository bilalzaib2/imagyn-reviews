import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { HelpfulVoteValue, castHelpfulVote } from "../services/review.server";
import { json, isPreflight, preflightResponse } from "./api.reviews";

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

  try {
    const result = await castHelpfulVote(reviewId, visitorId, voteValue as HelpfulVoteValue);
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to record vote." },
      { status: 400 },
    );
  }
};
