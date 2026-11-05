import { StatusBadge, type StatusBadgeTone } from "../ui/StatusBadge";
import { ReviewStatus } from "../../services/review.shared";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  [ReviewStatus.PENDING]: "Pending",
  [ReviewStatus.APPROVED]: "Approved",
  [ReviewStatus.REJECTED]: "Rejected",
};

// Converting this one component moved every screen that renders a review status onto the house
// badge at once — the Reviews queue, the review detail panel, and the product detail page's
// review list.
//
// REJECTED is `danger`, not the `attention` amber it was as a Polaris Badge. Rejecting a review
// is a terminal negative outcome, and amber said "look at this" where red says "this one is
// out" — which is the actual state.
const STATUS_TONE: Record<ReviewStatus, StatusBadgeTone> = {
  [ReviewStatus.PENDING]: "warning",
  [ReviewStatus.APPROVED]: "success",
  [ReviewStatus.REJECTED]: "danger",
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>;
}
