import type { ReactNode } from "react";
import styles from "../../styles/shared.module.css";

export type StatusBadgeTone = "success" | "warning" | "neutral" | "pro";

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  success: styles.statusBadgeSuccess,
  warning: styles.statusBadgeWarning,
  neutral: styles.statusBadgeNeutral,
  pro: styles.statusBadgePro,
};

// General-purpose status/plan badge for the app's custom (non-Polaris) pages — Enabled/Off,
// Pending Shopify approval, Coming soon, Pro, Needs setup, etc. Not a replacement for
// RequestStatusBadge (that one's Polaris Badge, scoped to the real ReviewRequestStatus enum,
// and stays on Polaris-driven pages so the two badge styles never mix on one screen). The
// label text is always the actual state name passed in as children — tone only reinforces it,
// never carries the meaning alone.
export function StatusBadge({ tone, children }: { tone: StatusBadgeTone; children: ReactNode }) {
  return <span className={`${styles.statusBadge} ${TONE_CLASS[tone]}`}>{children}</span>;
}
