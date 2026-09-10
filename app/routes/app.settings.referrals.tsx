import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { ContextualSaveBar } from "../components/ui/ContextualSaveBar";
import { Section } from "../components/ui/Section";
import { EmptyState } from "../components/ui/EmptyState";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  referralsService,
  getReferralProgram,
  updateReferralProgram,
  type ReferralProgramSettings,
  type ReferralRecord,
} from "../services/referrals.server";
import styles from "../styles/app.management.module.css";

// Settings > Rewards & Engagement > Referrals. A real customer-referral program: a referrer
// shares a real Shopify discount code; once a real order actually uses it, this app detects
// that from Shopify's own order data (no new webhook) and issues the referrer their own
// reward — see referrals.server.ts's header comment for exactly how.
type LoaderData = {
  program: ReferralProgramSettings;
  referrals: ReferralRecord[];
};

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const [program, referrals] = await Promise.all([getReferralProgram(store.id), referralsService.listReferrals(store.id)]);

  return { program, referrals };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "saveProgram") {
      const referrerValue = Number(formData.get("referrerValue") || "0");
      const refereeValue = Number(formData.get("refereeValue") || "0");
      if (!Number.isFinite(referrerValue) || referrerValue <= 0 || !Number.isFinite(refereeValue) || refereeValue <= 0) {
        return { ok: false, error: "Both reward values must be positive numbers." };
      }

      const minimumOrderAmountRaw = String(formData.get("minimumOrderAmount") || "").trim();
      const minimumOrderAmount = minimumOrderAmountRaw ? Number(minimumOrderAmountRaw) : null;

      await updateReferralProgram(store.id, {
        enabled: formData.get("enabled") === "true",
        referrerValueType: formData.get("referrerValueType") === "fixed_amount" ? "fixed_amount" : "percentage",
        referrerValue,
        refereeValueType: formData.get("refereeValueType") === "fixed_amount" ? "fixed_amount" : "percentage",
        refereeValue,
        minimumOrderAmount,
      });
      return { ok: true, message: "Referral program saved." };
    }

    if (intent === "createReferral") {
      const email = String(formData.get("referrerEmail") || "").trim();
      const name = String(formData.get("referrerName") || "").trim();
      if (!email) {
        return { ok: false, error: "Enter the referrer's email." };
      }
      const referral = await referralsService.createReferral(store.id, store.domain || session.shop, email, name || null);
      return { ok: true, message: `Referral code ${referral.code} created for ${email}.` };
    }

    if (intent === "checkConversions") {
      const id = String(formData.get("id") || "");
      const result = await referralsService.syncReferralConversions(store.id, store.domain || session.shop, id);
      return {
        ok: true,
        message:
          result.newConversions === 0
            ? "No new orders have used this code yet."
            : `${result.newConversions} new conversion(s) found, ${result.rewarded} reward(s) issued.`,
      };
    }

    return { ok: false, error: "Unknown action." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
};

const VALUE_TYPE_OPTIONS = [
  { label: "Percentage off", value: "percentage" },
  { label: "Fixed amount off", value: "fixed_amount" },
];

function ReferralRow({ referral }: { referral: ReferralRecord }) {
  const checkFetcher = useFetcher<ActionData>();

  const check = () => {
    const formData = new FormData();
    formData.set("intent", "checkConversions");
    formData.set("id", referral.id);
    checkFetcher.submit(formData, { method: "post" });
  };

  return (
    <div className={`${styles.card}${referral.conversionCount > 0 ? ` ${styles.cardAccent}` : ""}`}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.settingsGroupLabel}>{referral.referrerName || referral.referrerEmail}</p>
          <p className={styles.mutedText}>
            Code <strong>{referral.code}</strong> · {referral.conversionCount} conversion
            {referral.conversionCount === 1 ? "" : "s"} · {referral.rewardedCount} rewarded
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={check} disabled={checkFetcher.state !== "idle"}>
          {checkFetcher.state !== "idle" ? "Checking…" : "Check for new orders"}
        </Button>
      </div>
      {checkFetcher.data ? (
        <p className={styles.mutedText}>{checkFetcher.data.ok ? checkFetcher.data.message : checkFetcher.data.error}</p>
      ) : null}
    </div>
  );
}

export default function SettingsReferralsPage() {
  const { program, referrals } = useLoaderData<typeof loader>();
  const programFetcher = useFetcher<ActionData>();
  const createFetcher = useFetcher<ActionData>();
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const [enabled, setEnabled] = useState(program.enabled);
  const [referrerValueType, setReferrerValueType] = useState(program.referrerValueType);
  const [referrerValue, setReferrerValue] = useState(String(program.referrerValue));
  const [refereeValueType, setRefereeValueType] = useState(program.refereeValueType);
  const [refereeValue, setRefereeValue] = useState(String(program.refereeValue));
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(program.minimumOrderAmount ? String(program.minimumOrderAmount) : "");

  const [referrerEmail, setReferrerEmail] = useState("");
  const [referrerName, setReferrerName] = useState("");

  useEffect(() => {
    if (!programFetcher.data) return;
    setToast({ content: programFetcher.data.ok ? programFetcher.data.message! : programFetcher.data.error!, error: !programFetcher.data.ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programFetcher.data]);

  useEffect(() => {
    if (!createFetcher.data) return;
    setToast({ content: createFetcher.data.ok ? createFetcher.data.message! : createFetcher.data.error!, error: !createFetcher.data.ok });
    if (createFetcher.data.ok) {
      setReferrerEmail("");
      setReferrerName("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFetcher.data]);

  const saveProgram = () => {
    const formData = new FormData();
    formData.set("intent", "saveProgram");
    formData.set("enabled", String(enabled));
    formData.set("referrerValueType", referrerValueType);
    formData.set("referrerValue", referrerValue);
    formData.set("refereeValueType", refereeValueType);
    formData.set("refereeValue", refereeValue);
    formData.set("minimumOrderAmount", minimumOrderAmount);
    programFetcher.submit(formData, { method: "post" });
  };

  const createReferral = () => {
    const formData = new FormData();
    formData.set("intent", "createReferral");
    formData.set("referrerEmail", referrerEmail);
    formData.set("referrerName", referrerName);
    createFetcher.submit(formData, { method: "post" });
  };

  // Only the persisted program settings count as "unsaved changes" — referrerEmail/
  // referrerName below are ephemeral inputs for the separate "create a referral" action, not
  // a saved setting with a discard-to-previous-value contract.
  const hasUnsavedChanges =
    enabled !== program.enabled ||
    referrerValueType !== program.referrerValueType ||
    referrerValue !== String(program.referrerValue) ||
    refereeValueType !== program.refereeValueType ||
    refereeValue !== String(program.refereeValue) ||
    minimumOrderAmount !== (program.minimumOrderAmount ? String(program.minimumOrderAmount) : "");

  const handleDiscardProgram = () => {
    setEnabled(program.enabled);
    setReferrerValueType(program.referrerValueType);
    setReferrerValue(String(program.referrerValue));
    setRefereeValueType(program.refereeValueType);
    setRefereeValue(String(program.refereeValue));
    setMinimumOrderAmount(program.minimumOrderAmount ? String(program.minimumOrderAmount) : "");
  };

  return (
    <>
      <ContextualSaveBar
        id="referrals-save-bar"
        open={hasUnsavedChanges}
        saving={programFetcher.state !== "idle"}
        onSave={saveProgram}
        onDiscard={handleDiscardProgram}
      />
      <Section
        title="Referrals"
        description="Reward customers for bringing in new buyers. A referrer shares a real discount code; once a friend's real order uses it, the referrer gets their own reward automatically."
      >
        <Checkbox
          label="Enable Referrals"
          checked={enabled}
          onChange={setEnabled}
          helpText={enabled ? undefined : "Turn this on to configure rewards and start creating referral codes."}
        />

        {enabled ? (
          <>
            <p className={styles.settingsGroupLabel}>Reward for the new customer (referee)</p>
            <Select
              label="Discount type"
              options={VALUE_TYPE_OPTIONS}
              value={refereeValueType}
              onChange={(next) => setRefereeValueType(next as ReferralProgramSettings["refereeValueType"])}
            />
            <TextField
              label={refereeValueType === "percentage" ? "Percentage off" : "Amount off"}
              type="number"
              min={0}
              autoComplete="off"
              value={refereeValue}
              onChange={setRefereeValue}
              suffix={refereeValueType === "percentage" ? "%" : undefined}
            />

            <p className={styles.settingsGroupLabel}>Reward for the referrer</p>
            <Select
              label="Discount type"
              options={VALUE_TYPE_OPTIONS}
              value={referrerValueType}
              onChange={(next) => setReferrerValueType(next as ReferralProgramSettings["referrerValueType"])}
            />
            <TextField
              label={referrerValueType === "percentage" ? "Percentage off" : "Amount off"}
              type="number"
              min={0}
              autoComplete="off"
              value={referrerValue}
              onChange={setReferrerValue}
              suffix={referrerValueType === "percentage" ? "%" : undefined}
            />

            <TextField
              label="Minimum order amount for the referee (optional)"
              type="number"
              min={0}
              autoComplete="off"
              value={minimumOrderAmount}
              onChange={setMinimumOrderAmount}
              helpText="Leave blank for no minimum."
            />
          </>
        ) : null}

        <Button type="button" variant="primary" onClick={saveProgram} disabled={programFetcher.state !== "idle"}>
          {programFetcher.state !== "idle" ? "Saving…" : "Save"}
        </Button>
      </Section>

      {program.enabled ? (
        <Section title="Create a referral code" description="Generate a real, shareable discount code for a specific customer.">
          <TextField label="Referrer email" autoComplete="off" value={referrerEmail} onChange={setReferrerEmail} />
          <TextField label="Referrer name (optional)" autoComplete="off" value={referrerName} onChange={setReferrerName} />
          <Button type="button" variant="secondary" onClick={createReferral} disabled={createFetcher.state !== "idle" || !referrerEmail}>
            {createFetcher.state !== "idle" ? "Creating…" : "Create code"}
          </Button>
        </Section>
      ) : null}

      <Section title="Active referrals" description="Every code this store has created, and its real conversion status.">
        {referrals.length === 0 ? (
          <EmptyState
            title="No referral codes yet"
            description="Turn on Referrals above, then create your first code for a customer."
          />
        ) : (
          <div className={styles.cardList}>
            {referrals.map((referral) => (
              <ReferralRow key={referral.id} referral={referral} />
            ))}
          </div>
        )}
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
