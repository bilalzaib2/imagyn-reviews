import styles from "./system-preview.module.css";

// Replaces the static dashboard screenshot on the sign-in page with a small, honest
// representation of what the product actually does — collect a review, understand it
// (real moderation: rating threshold + banned-word check), then showcase it as a widget.
// No fabricated data: values are explicitly illustrative, matching the same convention
// the marketing site uses for demo content.
const STAGES = [
  {
    label: "Collect",
    body: (
      <div className={styles.card}>
        <div className={styles.stars}>★★★★★</div>
        <p className={styles.cardTitle}>Fast shipping, great quality</p>
        <p className={styles.cardMeta}>Priya K. · Verified</p>
      </div>
    ),
  },
  {
    label: "Understand",
    body: (
      <div className={styles.card}>
        <p className={styles.cardTitle}>Auto-published</p>
        <p className={styles.cardMeta}>Meets your rating &amp; content rules</p>
      </div>
    ),
  },
  {
    label: "Showcase",
    body: (
      <div className={styles.badge}>
        <span className={styles.stars}>★★★★★</span>
        <span className={styles.badgeText}>4.8 (128)</span>
      </div>
    ),
  },
];

export function SystemPreview() {
  return (
    <div className={styles.preview} role="img" aria-label="A review is collected, moderated, then shown as a storefront rating badge">
      {STAGES.map((stage, i) => (
        <div key={stage.label} className={styles.stage}>
          <div className={styles.stageInner} style={{ animationDelay: `${i * 140}ms` }}>
            <span className={styles.stageLabel}>{stage.label}</span>
            {stage.body}
          </div>
          {i < STAGES.length - 1 ? (
            <svg className={styles.arrow} width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M4 9h9m0 0l-3.5-3.5M13 9l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </div>
      ))}
    </div>
  );
}
