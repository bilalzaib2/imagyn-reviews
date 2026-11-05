import { StatusBadge } from "../ui/StatusBadge";

// A real, distinct trust signal — separate from ReviewStatusBadge (moderation state).
// "Approved"/"Auto Approved" says a review is public; this says the reviewer's purchase was
// verified. The two are independent facts about the same review and must never be conflated
// or implied from one another (see review.verifiedPurchase's own real, source-derived value —
// never inferred from status at render time).
//
// `success`, the functional green — matching the "✓ Verified" meta signal the Reviews table
// already renders in --color-success, so the badge and the row agree. Deliberately NOT the
// brand green, which FeaturedBadge uses: the two can appear on the same review, and they are
// different kinds of fact.
export function VerifiedBadge() {
  return <StatusBadge tone="success">Verified Buyer</StatusBadge>;
}
