import type { ReactNode } from "react";
import styles from "../../styles/shared.module.css";

/**
 * The app's badge tones. Seven, and the set is closed on purpose — a badge whose colour is
 * chosen per call site is how an interface ends up with four different greens.
 *
 *   success  a confirmed positive fact: approved, sent, verified, issued
 *   warning  waiting on something, or needing a look: pending
 *   danger   a real failure: rejected, failed
 *   info     a step in a process that is neither good nor bad: scheduled, delivered, opened
 *   brand    merchant-curated emphasis, or an earned marker: featured, clicked
 *   neutral  a plain fact with no valence: imported, cancelled
 *   pro      a plan gate, not a status
 *
 * `brand` and `success` are both green and are not interchangeable. The split follows what
 * the Reviews table already did with its inline meta signals, where Featured is the brand
 * sage (--color-brand-strong) and Verified is the functional green (--color-success) — so a
 * badge and the row it came from agree.
 */
export type StatusBadgeTone = "success" | "warning" | "danger" | "info" | "brand" | "neutral" | "pro";

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  success: styles.statusBadgeSuccess,
  warning: styles.statusBadgeWarning,
  danger: styles.statusBadgeDanger,
  info: styles.statusBadgeInfo,
  brand: styles.statusBadgeBrand,
  neutral: styles.statusBadgeNeutral,
  pro: styles.statusBadgePro,
};

// THE app's badge. Every merchant-facing badge now renders through this, including the six
// that used to be their own Polaris <Badge> wrappers (ReviewStatusBadge, RequestStatusBadge,
// FeaturedBadge, VerifiedBadge, ImportedBadge, RewardBadge) — which is what removed the
// second badge language, where a review's status badge and the button beside it disagreed
// about radius, type size and colour because one came from Polaris and one did not.
//
// The label text is always the actual state name passed in as children. Tone only reinforces
// it and never carries the meaning alone, so every badge still reads correctly in greyscale
// and to a colourblind merchant.
export function StatusBadge({ tone, children }: { tone: StatusBadgeTone; children: ReactNode }) {
  return <span className={`${styles.statusBadge} ${TONE_CLASS[tone]}`}>{children}</span>;
}
