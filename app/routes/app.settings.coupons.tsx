import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { StatusBadge, type StatusBadgeTone } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  couponsService,
  CouponNotEligibleError,
  type CouponRecord,
  type CouponDiscountType,
  type CouponEligibility,
  type CouponStatus,
} from "../services/coupons.server";
import styles from "../styles/app.management.module.css";

// Settings > Rewards & Engagement > Coupons. A real, standalone campaign system — independent
// of a review triggering it (contrast Review Rewards) — backed by the Coupon/CouponRedemption
// tables and the same real Shopify discount-issuance mutation Review Rewards uses (see
// shopifyDiscount.server.ts). No decorative toggle: every control here reads/writes a real row.
type LoaderData = {
  coupons: CouponRecord[];
};

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const coupons = await couponsService.listCoupons(store.id);

  return { coupons };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "create") {
      const name = String(formData.get("name") || "").trim();
      if (!name) {
        return { ok: false, error: "Give this coupon a name." };
      }

      const discountValue = Number(formData.get("discountValue") || "0");
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return { ok: false, error: "Discount value must be a positive number." };
      }

      const discountType = (formData.get("discountType") === "fixed_amount" ? "fixed_amount" : "percentage") as CouponDiscountType;
      if (discountType === "percentage" && discountValue > 100) {
        return { ok: false, error: "A percentage discount can't exceed 100%." };
      }

      const usageLimitRaw = String(formData.get("usageLimit") || "").trim();
      const usageLimit = usageLimitRaw ? Number(usageLimitRaw) : null;
      if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) {
        return { ok: false, error: "Total usage limit must be a whole number of at least 1, or left blank for unlimited." };
      }

      const perCustomerLimit = Number(formData.get("perCustomerLimit") || "1");
      if (!Number.isInteger(perCustomerLimit) || perCustomerLimit < 1) {
        return { ok: false, error: "Per-customer limit must be a whole number of at least 1." };
      }

      const minimumOrderAmountRaw = String(formData.get("minimumOrderAmount") || "").trim();
      const minimumOrderAmount = minimumOrderAmountRaw ? Number(minimumOrderAmountRaw) : null;
      if (minimumOrderAmount !== null && (!Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0)) {
        return { ok: false, error: "Minimum order amount must be a positive number, or left blank." };
      }

      const eligibility = (formData.get("eligibility") === "new_customers" ? "new_customers" : "all") as CouponEligibility;

      await couponsService.createCoupon(store.id, {
        name,
        discountType,
        discountValue,
        eligibility,
        minimumOrderAmount,
        usageLimit,
        perCustomerLimit,
      });

      return { ok: true, message: "Coupon created as a draft." };
    }

    if (intent === "setStatus") {
      const id = String(formData.get("id") || "");
      const status = String(formData.get("status") || "") as Exclude<CouponStatus, "draft">;
      if (!["active", "paused", "ended"].includes(status)) {
        return { ok: false, error: "Invalid status." };
      }
      await couponsService.setCouponStatus(store.id, id, status);
      return { ok: true, message: `Coupon marked ${status}.` };
    }

    if (intent === "issue") {
      const id = String(formData.get("id") || "");
      const email = String(formData.get("customerEmail") || "").trim();
      if (!email) {
        return { ok: false, error: "Enter a customer email to issue a code to." };
      }
      const redemption = await couponsService.issueRedemption(store.id, store.domain || session.shop, id, email);
      if (redemption.status === "failed") {
        return { ok: false, error: redemption.reason || "Unable to issue a code." };
      }
      return { ok: true, message: `Code ${redemption.discountCode} issued to ${email}.` };
    }

    return { ok: false, error: "Unknown action." };
  } catch (error) {
    if (error instanceof CouponNotEligibleError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
};

const DISCOUNT_TYPE_OPTIONS = [
  { label: "Percentage off", value: "percentage" },
  { label: "Fixed amount off", value: "fixed_amount" },
];

const ELIGIBILITY_OPTIONS = [
  { label: "All customers", value: "all" },
  { label: "New customers only", value: "new_customers" },
];

const STATUS_TONE: Record<CouponStatus, StatusBadgeTone> = {
  draft: "neutral",
  active: "success",
  paused: "warning",
  ended: "neutral",
};

function formatDiscount(coupon: CouponRecord): string {
  return coupon.discountType === "percentage" ? `${coupon.discountValue}% off` : `$${coupon.discountValue.toFixed(2)} off`;
}

function CouponRow({ coupon }: { coupon: CouponRecord }) {
  const statusFetcher = useFetcher<ActionData>();
  const issueFetcher = useFetcher<ActionData>();
  const [email, setEmail] = useState("");

  const setStatus = (status: Exclude<CouponStatus, "draft">) => {
    const formData = new FormData();
    formData.set("intent", "setStatus");
    formData.set("id", coupon.id);
    formData.set("status", status);
    statusFetcher.submit(formData, { method: "post" });
  };

  const issue = () => {
    const formData = new FormData();
    formData.set("intent", "issue");
    formData.set("id", coupon.id);
    formData.set("customerEmail", email);
    issueFetcher.submit(formData, { method: "post" });
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.settingsGroupLabel}>
            {coupon.name} <StatusBadge tone={STATUS_TONE[coupon.status]}>{coupon.status}</StatusBadge>
          </p>
          <p className={styles.mutedText}>
            {formatDiscount(coupon)} · {coupon.eligibility === "new_customers" ? "New customers only" : "All customers"} ·{" "}
            {coupon.issuedCount} issued{coupon.usageLimit ? ` of ${coupon.usageLimit}` : ""} · limit {coupon.perCustomerLimit} per
            customer
          </p>
        </div>
        <div className={styles.inlineActions}>
          {coupon.status !== "active" && coupon.status !== "ended" ? (
            <Button type="button" variant="secondary" onClick={() => setStatus("active")} disabled={statusFetcher.state !== "idle"}>
              Activate
            </Button>
          ) : null}
          {coupon.status === "active" ? (
            <Button type="button" variant="secondary" onClick={() => setStatus("paused")} disabled={statusFetcher.state !== "idle"}>
              Pause
            </Button>
          ) : null}
          {coupon.status !== "ended" ? (
            <Button type="button" variant="ghost" onClick={() => setStatus("ended")} disabled={statusFetcher.state !== "idle"}>
              End
            </Button>
          ) : null}
        </div>
      </div>

      {coupon.status === "active" ? (
        <div className={styles.inlineActions}>
          <TextField
            label="Issue to a customer"
            labelHidden
            placeholder="customer@example.com"
            autoComplete="off"
            value={email}
            onChange={setEmail}
          />
          <Button type="button" variant="secondary" onClick={issue} disabled={issueFetcher.state !== "idle" || !email}>
            Issue code
          </Button>
        </div>
      ) : null}
      {issueFetcher.data && !issueFetcher.data.ok ? <p className={styles.mutedText}>{issueFetcher.data.error}</p> : null}
      {issueFetcher.data?.ok && issueFetcher.data.message ? <p className={styles.mutedText}>{issueFetcher.data.message}</p> : null}
    </div>
  );
}

export default function SettingsCouponsPage() {
  const { coupons } = useLoaderData<typeof loader>();
  const createFetcher = useFetcher<ActionData>();
  const isCreating = createFetcher.state !== "idle";
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<CouponDiscountType>("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [eligibility, setEligibility] = useState<CouponEligibility>("all");
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("1");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!createFetcher.data) return;
    if (!createFetcher.data.ok) {
      setToast({ content: createFetcher.data.error || "Unable to save.", error: true });
      return;
    }
    setToast({ content: createFetcher.data.message || "Saved." });
    setName("");
    setDiscountValue("10");
    setMinimumOrderAmount("");
    setUsageLimit("");
    setPerCustomerLimit("1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createFetcher.data]);

  const handleCreate = () => {
    const formData = new FormData();
    formData.set("intent", "create");
    formData.set("name", name);
    formData.set("discountType", discountType);
    formData.set("discountValue", discountValue);
    formData.set("eligibility", eligibility);
    formData.set("minimumOrderAmount", minimumOrderAmount);
    formData.set("usageLimit", usageLimit);
    formData.set("perCustomerLimit", perCustomerLimit);
    createFetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Section
        title="Coupons"
        description="Create a promotional campaign independent of any review — a real Shopify discount code your team issues to customers directly."
      >
        <TextField label="Coupon name" autoComplete="off" value={name} onChange={setName} placeholder="Summer Sale" />
        <Select
          label="Discount type"
          options={DISCOUNT_TYPE_OPTIONS}
          value={discountType}
          onChange={(next) => setDiscountType(next as CouponDiscountType)}
        />
        <TextField
          label={discountType === "percentage" ? "Percentage off" : "Amount off (your store's currency)"}
          type="number"
          min={0}
          max={discountType === "percentage" ? 100 : undefined}
          autoComplete="off"
          value={discountValue}
          onChange={setDiscountValue}
          suffix={discountType === "percentage" ? "%" : undefined}
        />
        <Select
          label="Who can use it"
          options={ELIGIBILITY_OPTIONS}
          value={eligibility}
          onChange={(next) => setEligibility(next as CouponEligibility)}
        />

        <Checkbox label="More options" checked={showAdvanced} onChange={setShowAdvanced} />
        {showAdvanced ? (
          <>
            <TextField
              label="Minimum order amount (optional)"
              type="number"
              min={0}
              autoComplete="off"
              value={minimumOrderAmount}
              onChange={setMinimumOrderAmount}
              helpText="Leave blank for no minimum."
            />
            <TextField
              label="Total usage limit (optional)"
              type="number"
              min={1}
              autoComplete="off"
              value={usageLimit}
              onChange={setUsageLimit}
              helpText="Leave blank for unlimited."
            />
            <TextField
              label="Uses per customer"
              type="number"
              min={1}
              autoComplete="off"
              value={perCustomerLimit}
              onChange={setPerCustomerLimit}
            />
          </>
        ) : null}

        <Button type="button" variant="primary" onClick={handleCreate} disabled={isCreating || !name}>
          {isCreating ? "Creating…" : "Create coupon"}
        </Button>
      </Section>

      <Section title="Your coupons" description="Every campaign this store has created, and its real, live usage.">
        {coupons.length === 0 ? (
          <EmptyState title="No coupons yet" description="Create your first campaign above — it starts as a draft until you activate it." />
        ) : (
          <div className={styles.cardList}>
            {coupons.map((coupon) => (
              <CouponRow key={coupon.id} coupon={coupon} />
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
