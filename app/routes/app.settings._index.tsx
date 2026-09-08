import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Section } from "../components/ui/Section";
import { StatusBadge, type StatusBadgeTone } from "../components/ui/StatusBadge";
import { ActionCard } from "../components/ui/ActionCard";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { getPlan } from "../services/billing/plans";
import { getStorePlanId } from "../services/billing/billing.server";
import { ORDER_AUTOMATION_ENABLED, SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED } from "../config/features";
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
            !SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED
              ? "Pending Shopify approval"
              : !ORDER_AUTOMATION_ENABLED
                ? "Approved — activating soon"
                : !canUseAutomaticReviewRequests
                  ? "Requires Pro"
                  : autoRequestEnabled
                    ? "On"
                    : "Off"
          }
          tone={
            !SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED
              ? "warning"
              : !ORDER_AUTOMATION_ENABLED
                ? "warning"
                : !canUseAutomaticReviewRequests
                  ? "pro"
                  : autoRequestEnabled
                    ? "success"
                    : "neutral"
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

      <div className={styles.overviewLinks}>
        <ActionCard
          title="Request Scheduling"
          description="Set when review requests and reminders are sent."
          action={{ label: "Configure", href: "/app/settings/requests" }}
        />
        <ActionCard
          title="Publishing & Moderation"
          description="Control which reviews appear on your store."
          action={{ label: "Manage", href: "/app/settings/moderation" }}
        />
        <ActionCard
          title="Review Rewards"
          description="Reward customers for leaving reviews."
          action={{ label: "Configure", href: "/app/settings/rewards" }}
        />
      </div>
    </Section>
  );
}
