import { Badge } from "@shopify/polaris";
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

const STATUS_TONE: Record<ReviewRequestStatus, "success" | "warning" | "attention" | "info" | "new"> = {
  pending: "warning",
  scheduled: "info",
  sending: "info",
  sent: "success",
  delivered: "info",
  opened: "info",
  clicked: "new",
  completed: "success",
  failed: "attention",
  cancelled: "attention",
};

export function RequestStatusBadge({ status }: { status: ReviewRequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
