import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "../../styles/shared.module.css";

type BannerAction = { label: string; href: string };

type BannerProps = {
  title: string;
  description: ReactNode;
  tone?: "default" | "warning" | "success";
  /** A real navigation, not a button — every banner in this app links to the real page that
   *  lets the merchant act on it (Settings, Requests, etc.), never a no-op. */
  action?: BannerAction;
  secondaryAction?: BannerAction;
  onDismiss?: () => void;
};

const TONE_CLASS: Record<NonNullable<BannerProps["tone"]>, string> = {
  default: "",
  warning: styles.bannerWarning,
  success: styles.bannerSuccess,
};

// Reusable banner for feature education, setup guidance, and plan/approval status callouts —
// consolidates what were two independently-maintained, near-identical patterns (Dashboard's
// own .banner and the Requests page's .upgradeBanner). Every banner in this app is real: it
// reflects actual store state (see callers) and its action links to real functionality, never
// a decorative CTA or a fabricated feature.
export function Banner({ title, description, tone = "default", action, secondaryAction, onDismiss }: BannerProps) {
  return (
    <div className={`${styles.banner} ${TONE_CLASS[tone]}`}>
      <div className={styles.bannerText}>
        <p className={styles.bannerTitle}>{title}</p>
        <p className={styles.bannerSubtitle}>{description}</p>
      </div>
      <div className={styles.bannerActions}>
        {secondaryAction ? (
          <Link to={secondaryAction.href} className={styles.bannerLink}>
            {secondaryAction.label}
          </Link>
        ) : null}
        {action ? (
          <Link to={action.href} className={styles.bannerLink}>
            {action.label} &rarr;
          </Link>
        ) : null}
        {onDismiss ? (
          <button type="button" className={styles.bannerDismiss} onClick={onDismiss} aria-label="Dismiss">
            &times;
          </button>
        ) : null}
      </div>
    </div>
  );
}
