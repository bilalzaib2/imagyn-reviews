import type { PillarStatus } from "../../services/trustCertification.server";
import styles from "./pillar-status-icon.module.css";

// Shared between the Dashboard's Trust & Certification card and the Settings > Trust &
// Certification page — a real glyph per real PillarStatus value, never a decorative icon
// unrelated to the actual state. No external icon library: a plain inline SVG per status,
// matching this codebase's existing ad-hoc inline-SVG convention (see reviews-widget.js's
// verified-icon, trust-badge.js's CERTIFIED_ICON).
function renderGlyph(status: PillarStatus) {
  switch (status) {
    case "met":
      return (
        <path d="M4 8.3l2.6 2.6L12 5.2" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      );
    case "not_met":
      return (
        <>
          <path d="M8 4.6v4.1" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <circle cx="8" cy="11.1" r="0.9" fill="currentColor" />
        </>
      );
    case "pending":
      return (
        <>
          <circle cx="8" cy="8" r="4.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <path d="M8 5.6v2.6l1.8 1" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "needs_permission":
      return (
        <>
          <rect x="4.4" y="7.2" width="7.2" height="5.2" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M5.6 7.2V5.6a2.4 2.4 0 014.8 0v1.6" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </>
      );
    default:
      return null;
  }
}

const TONE_CLASS: Record<PillarStatus, string> = {
  met: styles.toneSuccess,
  not_met: styles.toneWarning,
  pending: styles.toneNeutral,
  needs_permission: styles.toneNeutral,
};

export function PillarStatusIcon({ status }: { status: PillarStatus }) {
  return (
    <span className={`${styles.icon} ${TONE_CLASS[status]}`} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        {renderGlyph(status)}
      </svg>
    </span>
  );
}
