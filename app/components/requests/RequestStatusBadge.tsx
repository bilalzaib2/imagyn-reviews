import { Badge } from "@shopify/polaris";
import type { ReviewRequestStatus } from "../../services/review-request.server";

const STATUS_LABEL: Record<ReviewRequestStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  opened: "Opened",
  reviewed: "Reviewed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<ReviewRequestStatus, "success" | "warning" | "attention" | "info" | "new"> = {
  draft: "warning",
  scheduled: "info",
  sending: "info",
  sent: "success",
  opened: "new",
  reviewed: "success",
  failed: "attention",
  cancelled: "attention",
};

export function RequestStatusBadge({ status }: { status: ReviewRequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
