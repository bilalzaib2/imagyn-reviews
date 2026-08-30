import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore, updateModerationSettings } from "../services/store.server";
import { getModerationSettings } from "../services/moderationRules.server";
import styles from "../styles/app.management.module.css";

// Settings > Review Display > Publishing & Moderation. Split out of the former single
// app.settings.tsx (now the Settings workspace shell) — same loader/action logic, unchanged.
type LoaderData = {
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
  const moderation = await getModerationSettings(store.id);

  return {
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
};

const MIN_RATING_OPTIONS = [
  { label: "5 stars only", value: "5" },
  { label: "4 stars and up", value: "4" },
  { label: "3 stars and up", value: "3" },
  { label: "2 stars and up", value: "2" },
  { label: "1 star and up", value: "1" },
];

export default function SettingsModerationPage() {
  const { moderation } = useLoaderData<typeof loader>();
  const moderationFetcher = useFetcher<ActionData>();
  const isSavingModeration = moderationFetcher.state !== "idle";

  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const [moderationEnabled, setModerationEnabled] = useState(moderation.enabled);
  const [minRating, setMinRating] = useState(String(moderation.minRating));
  const [requireVerified, setRequireVerified] = useState(moderation.requireVerified);
  const [holdLinks, setHoldLinks] = useState(moderation.holdLinks);
  const [holdProfanity, setHoldProfanity] = useState(moderation.holdProfanity);
  const [bannedWords, setBannedWords] = useState(moderation.bannedWords);
  const [notifyOnHold, setNotifyOnHold] = useState(moderation.notifyOnHold);
  const [notifyEmail, setNotifyEmail] = useState(moderation.notifyEmail);

  useEffect(() => {
    if (!moderationFetcher.data) return;
    if (!moderationFetcher.data.ok) {
      setToast({ content: moderationFetcher.data.error || "Unable to save Moderation Rules.", error: true });
      return;
    }
    setToast({ content: moderationFetcher.data.message || "Moderation Rules saved." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderationFetcher.data]);

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
      <Section
        title="Moderation Rules"
        description="Automatically publish trustworthy reviews and hold the rest for your review — reducing manual moderation without a complex rules builder."
      >
        <Checkbox
          label="Enable Moderation Rules"
          checked={moderationEnabled}
          onChange={setModerationEnabled}
          helpText={moderationEnabled ? undefined : "Turn this on to configure auto-publish, hold rules, and notifications."}
        />

        {moderationEnabled ? (
          <>
            <p className={styles.settingsGroupLabel}>Auto-publish</p>
            <Select label="Auto-publish reviews rated" options={MIN_RATING_OPTIONS} value={minRating} onChange={setMinRating} />
            <Checkbox label="Only auto-publish verified buyers" checked={requireVerified} onChange={setRequireVerified} />

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
            <Checkbox label="Email me when a review is held" checked={notifyOnHold} onChange={setNotifyOnHold} />
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

        <Button type="button" variant="primary" onClick={handleSaveModeration} disabled={isSavingModeration}>
          {isSavingModeration ? "Saving…" : "Save"}
        </Button>
      </Section>

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
