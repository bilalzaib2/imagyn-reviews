import type { ReviewRequestStatus } from "../../services/review-request.server";
import styles from "../../styles/app.requests.module.css";

const LIFECYCLE_STEPS: Array<{ status: ReviewRequestStatus; label: string }> = [
  { status: "pending", label: "Request created" },
  { status: "scheduled", label: "Waiting delay" },
  { status: "sending", label: "Sending" },
  { status: "sent", label: "Sent" },
  { status: "delivered", label: "Delivered" },
  { status: "opened", label: "Opened" },
  { status: "clicked", label: "Clicked" },
  { status: "completed", label: "Completed" },
];

// "failed" and "cancelled" are terminal branches off the main path, not steps within it (see
// ReviewRequestStatus) — the timeline shows how far the request got before branching off,
// rather than pretending they're points on the same line.
const TERMINAL_BRANCH_POINT: Record<"failed" | "cancelled", ReviewRequestStatus> = {
  failed: "sending",
  cancelled: "pending",
};

export function RequestLifecycleTimeline({ status }: { status: ReviewRequestStatus }) {
  const isTerminal = status === "failed" || status === "cancelled";
  const currentIndex = LIFECYCLE_STEPS.findIndex(
    (step) => step.status === (isTerminal ? TERMINAL_BRANCH_POINT[status as "failed" | "cancelled"] : status),
  );

  return (
    <ol className={styles.detailTimeline}>
      {LIFECYCLE_STEPS.map((step, index) => {
        const isDone = index < currentIndex || (!isTerminal && index === currentIndex);
        const isCurrent = !isTerminal && index === currentIndex;
        const labelClassName = isCurrent
          ? `${styles.detailTimelineLabel} ${styles.detailTimelineLabelCurrent}`
          : isDone
            ? styles.detailTimelineLabel
            : `${styles.detailTimelineLabel} ${styles.detailTimelineLabelUpcoming}`;

        return (
          <li key={step.status} className={styles.detailTimelineStep}>
            <span className={styles.detailTimelineMarker} aria-hidden="true">
              {isDone ? "✓" : index + 1}
            </span>
            <span className={labelClassName}>{step.label}</span>
          </li>
        );
      })}
      {isTerminal ? (
        <li className={styles.detailTimelineStep}>
          <span className={styles.detailTimelineMarker} aria-hidden="true">
            ✕
          </span>
          <span className={`${styles.detailTimelineLabel} ${styles.detailTimelineLabelCurrent}`}>
            {status === "failed" ? "Failed to send" : "Cancelled"}
          </span>
        </li>
      ) : null}
    </ol>
  );
}
