import { Section } from "../components/ui/Section";
import styles from "../styles/app.management.module.css";

// Settings > Rewards & Engagement > Referrals. Genuinely not built — no schema, no service,
// no enforcement point anywhere in the codebase. No loader/action, on purpose, since there is
// nothing yet to load or save. Shown honestly as future roadmap rather than a decorative
// toggle that would silently do nothing.
export default function SettingsReferralsPage() {
  return (
    <Section title="Referrals" description="Not built yet.">
      <p className={styles.mutedText}>
        A customer-referral program (e.g. rewarding a customer for bringing in a new buyer) doesn&apos;t exist in
        this app today — no schema, no tracking, no reward mechanism. This page will become real functionality
        here, not a decorative toggle, once it is.
      </p>
    </Section>
  );
}
