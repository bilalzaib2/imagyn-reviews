import { Section } from "../components/ui/Section";
import styles from "../styles/app.management.module.css";

// Settings > Rewards & Engagement > Coupons. Genuinely not built as a standalone feature —
// see app.settings.rewards.tsx for the real, working discount-issuance system this app does
// have (Review Rewards, real Shopify discount codes tied to review conditions). A dedicated,
// more general-purpose Coupons area (independent of a review being the trigger) is real
// future scope, not something to fake here with a decorative toggle — no loader/action, on
// purpose, since there is nothing yet to load or save.
export default function SettingsCouponsPage() {
  return (
    <Section title="Coupons" description="Not built yet as a standalone feature.">
      <p className={styles.mutedText}>
        Review Rewards (see <a href="/app/settings/rewards">Review Rewards</a>) already issues real Shopify
        discount codes automatically when a review meets your configured conditions. A separate, more
        general-purpose coupon system — independent of a review triggering it — isn&apos;t built yet. This page
        will become real functionality here, not a decorative toggle, once it is.
      </p>
    </Section>
  );
}
