import { Section } from "../components/ui/Section";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";

// Settings > Rewards & Engagement > Referrals. Genuinely not built — no schema, no service,
// no enforcement point anywhere in the codebase. No loader/action, on purpose, since there is
// nothing yet to load or save. Shown honestly as future roadmap rather than a decorative
// toggle that would silently do nothing.
export default function SettingsReferralsPage() {
  return (
    <Section title="Referrals" actions={<StatusBadge tone="neutral">Coming soon</StatusBadge>}>
      <EmptyState
        title="Not built yet"
        description="A customer-referral program (e.g. rewarding a customer for bringing in a new buyer) doesn't exist in this app today — no schema, no tracking, no reward mechanism. This page will become real functionality here, not a decorative toggle, once it is."
      />
    </Section>
  );
}
