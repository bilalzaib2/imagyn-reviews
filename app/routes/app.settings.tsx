import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Banner, Checkbox, Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import {
  getOrCreateStore,
  updateAutoRequestSettings,
  updateModerationSettings,
  updateReminderSettings,
} from "../services/store.server";
import { getModerationSettings } from "../services/moderationRules.server";
import { sendTestReviewRequestEmail } from "../services/notifications/testEmail.server";
import { getStorePermissions } from "../services/permissions";
import { ORDER_AUTOMATION_ENABLED } from "../config/features";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.management.module.css";

type LoaderData = {
  autoRequestEnabled: boolean;
  autoRequestDelayDays: number;
  autoRequestTrigger: string;
  planIncludesAutomaticRequests: boolean;
  reminderEmailsEnabled: boolean;
  planIncludesEmailReminders: boolean;
  moderation: {
    enabled: boolean;
    minRating: number;
    requireVerified: boolean;
    holdLinks: boolean;
    holdProfanity: boolean;
    bannedWords: string;
    notifyOnHold: boolean;
    notifyEmail: string;
  };
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
  const moderation = await getModerationSettings(store.id);

  return {
    autoRequestEnabled: store.autoRequestEnabled,
    autoRequestDelayDays: store.autoRequestDelayDays,
    autoRequestTrigger: store.autoRequestTrigger,
    planIncludesAutomaticRequests: permissions.canUseAutomaticReviewRequests,
    reminderEmailsEnabled: store.reminderEmailsEnabled,
    planIncludesEmailReminders: permissions.canUseEmailReminders,
    moderation: {
      enabled: moderation.enabled,
      minRating: moderation.minRating,
      requireVerified: moderation.requireVerified,
      holdLinks: moderation.holdLinks,
      holdProfanity: moderation.holdProfanity,
      bannedWords: moderation.bannedWords.join("\n"),
      notifyOnHold: moderation.notifyOnHold,
      notifyEmail: moderation.notifyEmail ?? "",
    },
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

  if (intent === "save-moderation") {
    const minRating = Number(formData.get("moderationMinRating") || "4");

    if (!Number.isInteger(minRating) || minRating < 1 || minRating > 5) {
      return { ok: false, error: "Minimum rating must be a whole number between 1 and 5." };
    }

    const notifyOnHold = formData.get("moderationNotifyOnHold") === "true";
    const notifyEmail = String(formData.get("moderationNotifyEmail") || "").trim();

    if (notifyOnHold && !EMAIL_PATTERN.test(notifyEmail)) {
      return { ok: false, error: "Enter a valid notification email address." };
    }

    try {
      await updateModerationSettings(store.id, {
        moderationRulesEnabled: formData.get("moderationRulesEnabled") === "true",
        moderationMinRating: minRating,
        moderationRequireVerified: formData.get("moderationRequireVerified") === "true",
        moderationHoldLinks: formData.get("moderationHoldLinks") === "true",
        moderationHoldProfanity: formData.get("moderationHoldProfanity") === "true",
        moderationBannedWords: String(formData.get("moderationBannedWords") || ""),
        moderationNotifyOnHold: notifyOnHold,
        moderationNotifyEmail: notifyEmail || null,
      });
      return { ok: true, message: "Moderation Rules saved." };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unable to save Moderation Rules." };
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

const MIN_RATING_OPTIONS = [
  { label: "5 stars only", value: "5" },
  { label: "4 stars and up", value: "4" },
  { label: "3 stars and up", value: "3" },
  { label: "2 stars and up", value: "2" },
  { label: "1 star and up", value: "1" },
];

export default function SettingsPage() {
  const {
    autoRequestEnabled,
    autoRequestDelayDays,
    planIncludesAutomaticRequests,
    reminderEmailsEnabled,
    planIncludesEmailReminders,
    moderation,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";
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

  const moderationFetcher = useFetcher<ActionData>();
  const isSavingModeration = moderationFetcher.state !== "idle";
  const [moderationEnabled, setModerationEnabled] = useState(moderation.enabled);
  const [minRating, setMinRating] = useState(String(moderation.minRating));
  const [requireVerified, setRequireVerified] = useState(moderation.requireVerified);
  const [holdLinks, setHoldLinks] = useState(moderation.holdLinks);
  const [holdProfanity, setHoldProfanity] = useState(moderation.holdProfanity);
  const [bannedWords, setBannedWords] = useState(moderation.bannedWords);
  const [notifyOnHold, setNotifyOnHold] = useState(moderation.notifyOnHold);
  const [notifyEmail, setNotifyEmail] = useState(moderation.notifyEmail);

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

  useEffect(() => {
    if (!moderationFetcher.data) return;
    if (!moderationFetcher.data.ok) {
      setToast({ content: moderationFetcher.data.error || "Unable to save Moderation Rules.", error: true });
      return;
    }
    setToast({ content: moderationFetcher.data.message || "Moderation Rules saved." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderationFetcher.data]);

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

  const handleSaveModeration = () => {
    const formData = new FormData();
    formData.set("_intent", "save-moderation");
    formData.set("moderationRulesEnabled", String(moderationEnabled));
    formData.set("moderationMinRating", minRating);
    formData.set("moderationRequireVerified", String(requireVerified));
    formData.set("moderationHoldLinks", String(holdLinks));
    formData.set("moderationHoldProfanity", String(holdProfanity));
    formData.set("moderationBannedWords", bannedWords);
    formData.set("moderationNotifyOnHold", String(notifyOnHold));
    formData.set("moderationNotifyEmail", notifyEmail);
    moderationFetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Container as="main">
        <div className={shellStyles.page}>
          <header className={`${shellStyles.header} ${styles.header}`}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Settings</h1>
              <p className={shellStyles.subtitle}>Manage app-level configuration and operational defaults.</p>
            </div>
          </header>

          {isLoading ? <p className={styles.mutedText}>Refreshing settings…</p> : null}

          <Section
            title="Moderation Rules"
            description="Automatically publish trustworthy reviews and hold the rest for your review — reducing manual moderation without a complex rules builder."
          >
            <Checkbox
              label="Enable Moderation Rules"
              checked={moderationEnabled}
              onChange={setModerationEnabled}
              helpText={
                moderationEnabled
                  ? undefined
                  : "Turn this on to configure auto-publish, hold rules, and notifications."
              }
            />

            {moderationEnabled ? (
              <>
                <p className={styles.settingsGroupLabel}>Auto-publish</p>
                <Select
                  label="Auto-publish reviews rated"
                  options={MIN_RATING_OPTIONS}
                  value={minRating}
                  onChange={setMinRating}
                />
                <Checkbox
                  label="Only auto-publish verified buyers"
                  checked={requireVerified}
                  onChange={setRequireVerified}
                />

                <p className={styles.settingsGroupLabel}>Always hold when a review</p>
                <Checkbox label="Contains a link" checked={holdLinks} onChange={setHoldLinks} />
                <Checkbox label="Contains profanity" checked={holdProfanity} onChange={setHoldProfanity} />
                <TextField
                  label="Contains a banned word or phrase"
                  value={bannedWords}
                  onChange={setBannedWords}
                  multiline={3}
                  autoComplete="off"
                  placeholder={"One word or phrase per line"}
                  helpText="A review containing any of these is always held, regardless of rating."
                />

                <p className={styles.settingsGroupLabel}>Notify me</p>
                <Checkbox
                  label="Email me when a review is held"
                  checked={notifyOnHold}
                  onChange={setNotifyOnHold}
                />
                {notifyOnHold ? (
                  <TextField
                    label="Notification email"
                    type="email"
                    autoComplete="off"
                    placeholder="you@example.com"
                    value={notifyEmail}
                    onChange={setNotifyEmail}
                  />
                ) : null}
              </>
            ) : null}

            <Button
              type="button"
              variant="primary"
              onClick={handleSaveModeration}
              disabled={isSavingModeration}
            >
              {isSavingModeration ? "Saving…" : "Save"}
            </Button>
          </Section>

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
                Automatic review requests require the Pro plan.{" "}
                <a href="/app/billing">Upgrade to Pro</a> to turn this on.
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
                <a href="/app/billing">Upgrade to Pro</a> to turn them on. The Day 0 review request email above
                always sends regardless of plan.
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
        </div>
      </Container>

      <Frame>
        {toast ? <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} /> : null}
      </Frame>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
