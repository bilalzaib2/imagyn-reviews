import { Badge } from "@shopify/polaris";
import { ReviewStatus } from "../../services/review.shared";

const STATUS_LABEL: Record<ReviewStatus, string> = {
  [ReviewStatus.PENDING]: "Pending",
  [ReviewStatus.APPROVED]: "Approved",
  [ReviewStatus.REJECTED]: "Rejected",
};

const STATUS_TONE: Record<ReviewStatus, "success" | "warning" | "attention"> = {
  [ReviewStatus.PENDING]: "warning",
  [ReviewStatus.APPROVED]: "success",
  [ReviewStatus.REJECTED]: "attention",
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
