import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Banner, Checkbox, Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore, updateAutoRequestSettings, updateReminderSettings } from "../services/store.server";
import { sendTestReviewRequestEmail } from "../services/notifications/testEmail.server";
import { getStorePermissions } from "../services/permissions";
import { ORDER_AUTOMATION_ENABLED } from "../config/features";
import styles from "../styles/app.management.module.css";

// Settings > Review Collection > Request Scheduling. Split out of the former single
// app.settings.tsx (now the Settings workspace shell — see app.settings.tsx) — same
// loader/action logic, unchanged, just scoped to its own route so it has its own place in
// the workspace's secondary nav instead of sharing one page with Moderation Rules.
type LoaderData = {
  autoRequestEnabled: boolean;
  autoRequestDelayDays: number;
  planIncludesAutomaticRequests: boolean;
  reminderEmailsEnabled: boolean;
  planIncludesEmailReminders: boolean;
};

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const permissions = await getStorePermissions(store.id);

  return {
    autoRequestEnabled: store.autoRequestEnabled,
    autoRequestDelayDays: store.autoRequestDelayDays,
    planIncludesAutomaticRequests: permissions.canUseAutomaticReviewRequests,
    reminderEmailsEnabled: store.reminderEmailsEnabled,
    planIncludesEmailReminders: permissions.canUseEmailReminders,
  };
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  if (intent === "send-test-email") {
    const testEmail = String(formData.get("testEmail") || "").trim();

    if (!EMAIL_PATTERN.test(testEmail)) {
      return { ok: false, error: "Enter a valid email address." };
    }

    try {
      await sendTestReviewRequestEmail(testEmail, store.id, store.name);
      return { ok: true, message: `Test email sent to ${testEmail}.` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unable to send test email." };
    }
  }

  if (intent === "save-reminders") {
    const permissions = await getStorePermissions(store.id);
    if (!permissions.canUseEmailReminders) {
      return { ok: false, error: "Automatic Reminder Emails require the Pro plan." };
    }

    try {
      await updateReminderSettings(store.id, {
        reminderEmailsEnabled: formData.get("reminderEmailsEnabled") === "true",
      });
      return { ok: true, message: "Reminder Emails settings saved." };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unable to save Reminder Emails settings." };
    }
  }

  if (!ORDER_AUTOMATION_ENABLED) {
    return { ok: false, error: "Automatic review requests are not available yet." };
  }

  const permissions = await getStorePermissions(store.id);
  if (!permissions.canUseAutomaticReviewRequests) {
    return { ok: false, error: "Automatic review requests require the Pro plan." };
  }

  const autoRequestEnabled = formData.get("autoRequestEnabled") === "true";
  const autoRequestDelayDays = Number(formData.get("autoRequestDelayDays") || "0");

  if (!Number.isFinite(autoRequestDelayDays) || autoRequestDelayDays < 0) {
    return { ok: false, error: "Delay must be a positive number of days." };
  }

  try {
    await updateAutoRequestSettings(store.id, { autoRequestEnabled, autoRequestDelayDays });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to save settings." };
  }
};

// Only one real trigger type exists today ("fulfillment"). Modeled as a Select with a single
// option — rather than hardcoding the concept away — because Store.autoRequestTrigger is
// deliberately a plain string precisely so a future trigger (e.g. "delivery", once Shopify's
// delivery-confirmation signal is wired in) is a config addition here, not a schema change.
const TRIGGER_OPTIONS = [{ label: "After fulfillment", value: "fulfillment" }];

export default function SettingsRequestsPage() {
  const {
    autoRequestEnabled,
    autoRequestDelayDays,
    planIncludesAutomaticRequests,
    reminderEmailsEnabled,
    planIncludesEmailReminders,
  } = useLoaderData<typeof loader>();

  const saveFetcher = useFetcher<ActionData>();
  const isSaving = saveFetcher.state !== "idle";
  const isAutomationAvailable = ORDER_AUTOMATION_ENABLED && planIncludesAutomaticRequests;

  const [enabled, setEnabled] = useState(autoRequestEnabled);
  const [delayDays, setDelayDays] = useState(String(autoRequestDelayDays));
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const testEmailFetcher = useFetcher<ActionData>();
  const isSendingTestEmail = testEmailFetcher.state !== "idle";
  const [testEmail, setTestEmail] = useState("");

  const reminderFetcher = useFetcher<ActionData>();
  const isSavingReminders = reminderFetcher.state !== "idle";
  const [remindersEnabled, setRemindersEnabled] = useState(reminderEmailsEnabled);

  useEffect(() => {
    if (!saveFetcher.data) return;
    if (!saveFetcher.data.ok) {
      setToast({ content: saveFetcher.data.error || "Unable to save settings.", error: true });
      return;
    }
    setToast({ content: "Automation settings saved." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.data]);

  useEffect(() => {
    if (!testEmailFetcher.data) return;
    if (!testEmailFetcher.data.ok) {
      setToast({ content: testEmailFetcher.data.error || "Unable to send test email.", error: true });
      return;
    }
    setToast({ content: testEmailFetcher.data.message || "Test email sent." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testEmailFetcher.data]);

  useEffect(() => {
    if (!reminderFetcher.data) return;
    if (!reminderFetcher.data.ok) {
      setToast({ content: reminderFetcher.data.error || "Unable to save Reminder Emails settings.", error: true });
      return;
    }
    setToast({ content: reminderFetcher.data.message || "Reminder Emails settings saved." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderFetcher.data]);

  const handleSave = () => {
    const formData = new FormData();
    formData.set("_intent", "save-automation");
    formData.set("autoRequestEnabled", String(enabled));
    formData.set("autoRequestDelayDays", delayDays ?? "7");
    saveFetcher.submit(formData, { method: "post" });
  };

  const handleSendTestEmail = () => {
    const formData = new FormData();
    formData.set("_intent", "send-test-email");
    formData.set("testEmail", testEmail);
    testEmailFetcher.submit(formData, { method: "post" });
  };

  const handleSaveReminders = () => {
    const formData = new FormData();
    formData.set("_intent", "save-reminders");
    formData.set("reminderEmailsEnabled", String(remindersEnabled));
    reminderFetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Section
        title="Automatic review requests"
        description="Automatically create a Review Request for every fulfilled order line item, instead of creating them by hand."
      >
        {!ORDER_AUTOMATION_ENABLED ? (
          <Banner tone="info">
            Pending Shopify approval: automatic review requests read order fulfillment details, which
            requires Shopify&apos;s Protected Customer Data approval for this app. This section will
            activate automatically once that&apos;s granted &mdash; manual review requests are unaffected
            and fully available today, including their full email schedule (see Reminder Emails below).
          </Banner>
        ) : !planIncludesAutomaticRequests ? (
          <Banner tone="info">
            Automatic review requests require the Pro plan. <a href="/app/billing">Upgrade to Pro</a> to
            turn this on.
          </Banner>
        ) : null}
        <Checkbox
          label="Automatically request reviews after fulfillment"
          checked={isAutomationAvailable && enabled}
          disabled={!isAutomationAvailable}
          onChange={setEnabled}
        />
        {isAutomationAvailable && enabled ? (
          <>
            <Select
              label="Trigger"
              options={TRIGGER_OPTIONS}
              value="fulfillment"
              disabled
              helpText="More trigger types (e.g. after delivery) are planned."
              onChange={() => {}}
            />
            <TextField
              label="Send delay (days)"
              type="number"
              min={0}
              autoComplete="off"
              value={delayDays}
              onChange={setDelayDays}
              helpText="How long to wait after fulfillment before sending the review request email."
            />
          </>
        ) : null}
        <Button type="button" variant="primary" onClick={handleSave} disabled={isSaving || !isAutomationAvailable}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </Section>

      <Section
        title="Reminder Emails"
        description="The full automatic email schedule for every review request — sent whether the request was created manually or automatically above. Stops immediately once a review is submitted."
      >
        <p className={styles.settingsGroupLabel}>Email schedule</p>
        <p className={styles.mutedText}>Day 0 — Review request email, sent as soon as the request is created.</p>
        <p className={styles.mutedText}>Day 3 — Reminder #1, only if no review has been submitted yet.</p>
        <p className={styles.mutedText}>Day 7 — Final Reminder, only if no review has been submitted yet.</p>

        {!planIncludesEmailReminders ? (
          <Banner tone="info">
            Reminder Emails (Day 3 and Day 7) require the Pro plan.{" "}
            <a href="/app/billing">Upgrade to Pro</a> to turn them on. The Day 0 review request email
            above always sends regardless of plan.
          </Banner>
        ) : null}
        <Checkbox
          label="Automatically send Day 3 and Day 7 reminder emails"
          checked={planIncludesEmailReminders && remindersEnabled}
          disabled={!planIncludesEmailReminders}
          onChange={setRemindersEnabled}
          helpText="Only requests sent after this is turned on are ever eligible — existing requests are never swept up retroactively."
        />
        <p className={styles.mutedText}>
          Edit the content of all three emails (Review Request, Reminder #1, Final Reminder) in{" "}
          <a href="/app/email-studio">Email Studio</a>.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={handleSaveReminders}
          disabled={isSavingReminders || !planIncludesEmailReminders}
        >
          {isSavingReminders ? "Saving…" : "Save"}
        </Button>
      </Section>

      <div className={styles.diagnosticsBlock}>
        <Section
          title="Diagnostics"
          description="Send a real test email using the same template and provider real review requests use — useful when troubleshooting delivery, not something you need to touch day-to-day."
        >
          <TextField
            label="Send test email to"
            type="email"
            autoComplete="off"
            placeholder="you@example.com"
            value={testEmail}
            onChange={setTestEmail}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleSendTestEmail}
            disabled={isSendingTestEmail || !testEmail}
          >
            {isSendingTestEmail ? "Sending…" : "Send Test Email"}
          </Button>
        </Section>
      </div>

      <div className={styles.toastFrame}>
        <Frame>
          {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}
        </Frame>
      </div>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
