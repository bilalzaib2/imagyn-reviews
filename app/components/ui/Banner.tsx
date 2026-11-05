import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "../../styles/shared.module.css";

type BannerAction = { label: string; href: string };

type BannerProps = {
  /**
   * Optional. A banner with a title is a setup or education callout, which is what this
   * component was built for. A banner WITHOUT one is an inline message — a validation error,
   * a dry-run result, a plan note — which is what the Polaris <Banner> used to do on eight
   * screens, in its own visual language. Both are "a coloured message box", so they are one
   * component rather than two that drift.
   */
  title?: string;
  /**
   * The body, as a prop. Every pre-existing caller passes it this way.
   *
   * `children` does the same job and is the idiomatic form for a body that contains markup —
   * which the converted Polaris call sites do (several pass more than one paragraph). Both are
   * supported rather than one being forced, because rewriting a dozen multi-paragraph bodies
   * into a prop would have been churn for no gain. `children` wins if both are given.
   */
  description?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "info" | "warning" | "success" | "critical";
  /** A real navigation, not a button — every banner in this app links to the real page that
   *  lets the merchant act on it (Settings, Requests, etc.), never a no-op. */
  action?: BannerAction;
  secondaryAction?: BannerAction;
  onDismiss?: () => void;
};

const TONE_CLASS: Record<NonNullable<BannerProps["tone"]>, string> = {
  default: "",
  info: styles.bannerInfo,
  warning: styles.bannerWarning,
  success: styles.bannerSuccess,
  critical: styles.bannerCritical,
};

/** Tones that describe a problem are announced to assistive technology as they appear, because
 *  a merchant who just submitted a form needs to know it failed without hunting for the
 *  reason. "assertive" interrupts; the quieter tones use a polite live region so a plan note
 *  appearing on load does not talk over whatever is being read. */
const TONE_ROLE: Record<NonNullable<BannerProps["tone"]>, "alert" | "status" | undefined> = {
  default: undefined,
  info: "status",
  warning: "status",
  success: "status",
  critical: "alert",
};

// Reusable banner for feature education, setup guidance, and plan/approval status callouts —
// consolidates what were two independently-maintained, near-identical patterns (Dashboard's
// own .banner and the Requests page's .upgradeBanner). Every banner in this app is real: it
// reflects actual store state (see callers) and its action links to real functionality, never
// a decorative CTA or a fabricated feature.
export function Banner({
  title,
  description,
  children,
  tone = "default",
  action,
  secondaryAction,
  onDismiss,
}: BannerProps) {
  const body = children ?? description;
  const hasActions = Boolean(action || secondaryAction || onDismiss);

  return (
    <div className={`${styles.banner} ${TONE_CLASS[tone]}`} role={TONE_ROLE[tone]}>
      <div className={styles.bannerText}>
        {title ? <p className={styles.bannerTitle}>{title}</p> : null}
        {/* A <div>, not a <p>: several converted call sites pass their own <p> elements, and a
            <p> inside a <p> is invalid HTML that browsers silently restructure — which breaks
            the styling applied here. The class carries the typography either way, so this is
            visually identical for the callers that pass a plain string.

            Without a title the body IS the message, so it takes the primary ink rather than
            the muted secondary — a lone grey sentence reads as a caption for something that
            is not there. */}
        <div className={title ? styles.bannerSubtitle : styles.bannerMessage}>{body}</div>
      </div>
      {hasActions ? (
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
      ) : null}
    </div>
  );
}
