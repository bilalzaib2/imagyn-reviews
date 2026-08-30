import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Select, Text, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getRewardSettings, getRewardStats, updateRewardSettings, type RewardSettings } from "../services/rewards.server";
import styles from "../styles/app.management.module.css";

// Settings > Rewards & Engagement > Review Rewards. Deliberately Free-tier (see
// rewards.server.ts's own header comment) — every control here works on every plan. Real
// eligibility conditions only: every checkbox here maps 1:1 to a real, already-tracked
// Review attribute (rating, verifiedPurchase, attached photo/video) evaluated by
// rewards.server.ts's evaluateEligibility, never an invented condition.
type LoaderData = {
  settings: RewardSettings;
  stats: { issued: number; pending: number; failed: number; ineligible: number };
};

type ActionData = {
  ok: boolean;
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const [settings, stats] = await Promise.all([getRewardSettings(store.id), getRewardStats(store.id)]);

  return { settings, stats };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();

  const value = Number(formData.get("value") || "0");
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "Reward value must be a positive number." };
  }

  const minRating = Number(formData.get("minRating") || "4");
  if (!Number.isInteger(minRating) || minRating < 1 || minRating > 5) {
    return { ok: false, error: "Minimum rating must be a whole number between 1 and 5." };
  }

  const valueType = formData.get("valueType") === "fixed_amount" ? "fixed_amount" : "percentage";
  if (valueType === "percentage" && value > 100) {
    return { ok: false, error: "A percentage reward can't exceed 100%." };
  }

  try {
    await updateRewardSettings(store.id, {
      enabled: formData.get("enabled") === "true",
      valueType,
      value,
      minRating,
      requireVerified: formData.get("requireVerified") === "true",
      requirePhoto: formData.get("requirePhoto") === "true",
      requireVideo: formData.get("requireVideo") === "true",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to save Review Rewards settings." };
  }
};

const MIN_RATING_OPTIONS = [
  { label: "5 stars only", value: "5" },
  { label: "4 stars and up", value: "4" },
  { label: "3 stars and up", value: "3" },
  { label: "2 stars and up", value: "2" },
  { label: "1 star and up", value: "1" },
];

const VALUE_TYPE_OPTIONS = [
  { label: "Percentage off", value: "percentage" },
  { label: "Fixed amount off", value: "fixed_amount" },
];

export default function SettingsRewardsPage() {
  const { settings, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isSaving = fetcher.state !== "idle";
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const [enabled, setEnabled] = useState(settings.enabled);
  const [valueType, setValueType] = useState(settings.valueType);
  const [value, setValue] = useState(String(settings.value));
  const [minRating, setMinRating] = useState(String(settings.minRating));
  const [requireVerified, setRequireVerified] = useState(settings.requireVerified);
  const [requirePhoto, setRequirePhoto] = useState(settings.requirePhoto);
  const [requireVideo, setRequireVideo] = useState(settings.requireVideo);

  useEffect(() => {
    if (!fetcher.data) return;
    if (!fetcher.data.ok) {
      setToast({ content: fetcher.data.error || "Unable to save.", error: true });
      return;
    }
    setToast({ content: "Review Rewards saved." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const handleSave = () => {
    const formData = new FormData();
    formData.set("enabled", String(enabled));
    formData.set("valueType", valueType);
    formData.set("value", value);
    formData.set("minRating", minRating);
    formData.set("requireVerified", String(requireVerified));
    formData.set("requirePhoto", String(requirePhoto));
    formData.set("requireVideo", String(requireVideo));
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Section
        title="Review Rewards"
        description="Automatically create a real Shopify discount code and email it to a customer once their review meets the conditions below. A conceptual flow, made real: purchase → review request → review submitted → conditions checked → discount created → customer emailed."
      >
        <Checkbox
          label="Enable Review Rewards"
          checked={enabled}
          onChange={setEnabled}
          helpText={enabled ? undefined : "Turn this on to configure the reward and its conditions."}
        />

        {enabled ? (
          <>
            <p className={styles.settingsGroupLabel}>Reward</p>
            <Select label="Reward type" options={VALUE_TYPE_OPTIONS} value={valueType} onChange={(next) => setValueType(next as RewardSettings["valueType"])} />
            <TextField
              label={valueType === "percentage" ? "Percentage off" : "Amount off (in your store's currency)"}
              type="number"
              min={0}
              max={valueType === "percentage" ? 100 : undefined}
              autoComplete="off"
              value={value}
              onChange={setValue}
              suffix={valueType === "percentage" ? "%" : undefined}
            />

            <p className={styles.settingsGroupLabel}>Conditions — a review must meet all of these</p>
            <Select label="Minimum rating" options={MIN_RATING_OPTIONS} value={minRating} onChange={setMinRating} />
            <Checkbox label="Must be a verified purchase" checked={requireVerified} onChange={setRequireVerified} />
            <Checkbox label="Must include a photo" checked={requirePhoto} onChange={setRequirePhoto} />
            <Checkbox label="Must include a video" checked={requireVideo} onChange={setRequireVideo} />

            <p className={styles.mutedText}>
              A discount code is created only once per review, the moment it's approved and meets every condition
              above — never before, and never twice for the same review. The customer is emailed using the
              &quot;Review Reward&quot; template in <a href="/app/email-studio?type=reward">Email Studio</a>.
            </p>
          </>
        ) : null}

        <Button type="button" variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </Section>

      <Section title="Reward activity" description="A real, live count of every review this store has evaluated for a reward.">
        <div className={styles.mutedText}>
          <Text as="p">
            {stats.issued} issued · {stats.failed} failed · {stats.ineligible} didn&apos;t meet the conditions
          </Text>
        </div>
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
