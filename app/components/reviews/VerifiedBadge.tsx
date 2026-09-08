import { Badge } from "@shopify/polaris";

// A real, distinct trust signal — separate from ReviewStatusBadge (moderation state).
// "Approved"/"Auto Approved" says a review is public; this says the reviewer's purchase was
// verified. The two are independent facts about the same review and must never be conflated
// or implied from one another (see review.verifiedPurchase's own real, source-derived value —
// never inferred from status at render time).
export function VerifiedBadge() {
  return <Badge tone="info">Verified Buyer</Badge>;
}
