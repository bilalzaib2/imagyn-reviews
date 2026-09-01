import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Section } from "../components/ui/Section";
import { StatusBadge, type StatusBadgeTone } from "../components/ui/StatusBadge";
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
  reminder1DelayDays: number;
  reminderFinalDelayDays: number;
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
    reminder1DelayDays: store.reminder1DelayDays,
    reminderFinalDelayDays: store.reminderFinalDelayDays,
    canUseAutomaticReviewRequests: permissions.canUseAutomaticReviewRequests,
    canUseEmailReminders: permissions.canUseEmailReminders,
    canUseCustomBranding: permissions.canUseCustomBranding,
  };
};

function StatusRow({ label, state, tone }: { label: string; state: string; tone: StatusBadgeTone }) {
  return (
    <div className={styles.statusRow}>
      <span>{label}</span>
      <StatusBadge tone={tone}>{state}</StatusBadge>
    </div>
  );
}

export default function SettingsOverviewPage() {
  const {
    planName,
    autoRequestEnabled,
    reminderEmailsEnabled,
    reminder1DelayDays,
    reminderFinalDelayDays,
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
          tone={
            !ORDER_AUTOMATION_ENABLED ? "warning" : !canUseAutomaticReviewRequests ? "pro" : autoRequestEnabled ? "success" : "neutral"
          }
        />
        <StatusRow
          label={`Reminder emails (Day ${reminder1DelayDays} / Day ${reminderFinalDelayDays})`}
          state={!canUseEmailReminders ? "Requires Pro" : reminderEmailsEnabled ? "On" : "Off"}
          tone={!canUseEmailReminders ? "pro" : reminderEmailsEnabled ? "success" : "neutral"}
        />
        <StatusRow
          label='"Powered by Imagyn" removal'
          state={canUseCustomBranding ? "Available" : "Requires Pro"}
          tone={canUseCustomBranding ? "success" : "pro"}
        />
      </div>

      {/* Real <a>, not <Link> — same reason app.settings.tsx's own sidebar uses real anchors:
          a client-side pushState here is exactly what Shopify's embedded shell silently
          reverts once it doesn't recognize the resulting URL. */}
      <div className={styles.overviewLinks}>
        <a href="/app/settings/requests">Configure request scheduling &amp; reminders</a>
        <a href="/app/settings/moderation">Configure publishing &amp; moderation</a>
        <a href="/app/settings/rewards">Configure Review Rewards</a>
      </div>
    </Section>
  );
}
