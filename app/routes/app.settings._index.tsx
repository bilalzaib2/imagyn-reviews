import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { getPlan } from "../services/billing/plans";
import { getStorePlanId } from "../services/billing/billing.server";
import { ORDER_AUTOMATION_ENABLED } from "../config/features";
import styles from "../styles/app.settingsWorkspace.module.css";

// Settings workspace index — a real status summary of what's actually configured right now
// (not decorative), with the primary entry points into the rest of the workspace. Every
// number/state here is read directly off the store's own real settings, the same values
// each dedicated sub-page reads.
type LoaderData = {
  planName: string;
  autoRequestEnabled: boolean;
  reminderEmailsEnabled: boolean;
  canUseAutomaticReviewRequests: boolean;
  canUseEmailReminders: boolean;
  canUseCustomBranding: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const [planId, permissions] = await Promise.all([getStorePlanId(store.id), getStorePermissions(store.id)]);

  return {
    planName: getPlan(planId).name,
    autoRequestEnabled: store.autoRequestEnabled,
    reminderEmailsEnabled: store.reminderEmailsEnabled,
    canUseAutomaticReviewRequests: permissions.canUseAutomaticReviewRequests,
    canUseEmailReminders: permissions.canUseEmailReminders,
    canUseCustomBranding: permissions.canUseCustomBranding,
  };
};

function StatusRow({ label, state }: { label: string; state: string }) {
  return (
    <div className={styles.statusRow}>
      <span>{label}</span>
      <span className={styles.statusValue}>{state}</span>
    </div>
  );
}

export default function SettingsOverviewPage() {
  const {
    planName,
    autoRequestEnabled,
    reminderEmailsEnabled,
    canUseAutomaticReviewRequests,
    canUseEmailReminders,
    canUseCustomBranding,
  } = useLoaderData<typeof loader>();

  return (
    <Section title="Overview" description={`You're on the ${planName} plan.`}>
      <div className={styles.statusList}>
        <StatusRow
          label="Automatic review requests"
          state={
            !ORDER_AUTOMATION_ENABLED
              ? "Pending Shopify approval"
              : !canUseAutomaticReviewRequests
                ? "Requires Pro"
                : autoRequestEnabled
                  ? "On"
                  : "Off"
          }
        />
        <StatusRow
          label="Day 3 / Day 7 reminder emails"
          state={!canUseEmailReminders ? "Requires Pro" : reminderEmailsEnabled ? "On" : "Off"}
        />
        <StatusRow label='"Powered by Imagyn" removal' state={canUseCustomBranding ? "Available" : "Requires Pro"} />
      </div>

      <div className={styles.overviewLinks}>
        <Link to="/app/settings/requests">Configure request scheduling &amp; reminders</Link>
        <Link to="/app/settings/moderation">Configure publishing &amp; moderation</Link>
        <Link to="/app/settings/rewards">Configure Review Rewards</Link>
      </div>
    </Section>
  );
}
