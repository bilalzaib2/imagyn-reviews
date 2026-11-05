import { StatusBadge, type StatusBadgeTone } from "../ui/StatusBadge";
import type { ReviewRequestStatus } from "../../services/review-request.server";

const STATUS_LABEL: Record<ReviewRequestStatus, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

// The request lifecycle, toned by what each state actually means rather than by how far along
// it is. Two corrections came with the move off Polaris Badge:
//
//   failed     was `attention` (amber). A send that failed is a real failure the merchant has
//              to act on — `danger`.
//   cancelled  was also `attention`. Cancelling is a deliberate stop, not a problem, so amber
//              put a warning colour on the merchant's own decision — `neutral`.
//
// `clicked` is the brand accent because it is the one state in this list that represents the
// customer actually engaging, which is the whole point of sending the request.
const STATUS_TONE: Record<ReviewRequestStatus, StatusBadgeTone> = {
  pending: "warning",
  scheduled: "info",
  sending: "info",
  sent: "success",
  delivered: "info",
  opened: "info",
  clicked: "brand",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
};

export function RequestStatusBadge({ status }: { status: ReviewRequestStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>;
}
