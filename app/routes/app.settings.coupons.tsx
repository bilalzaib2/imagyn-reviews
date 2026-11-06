import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Select, TextField, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { StatusBadge, type StatusBadgeTone } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { Banner } from "../components/ui/Banner";
import { Table, type TableColumn } from "../components/ui/Table";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  couponsService,
  CouponNotEligibleError,
  type CouponRecord,
  type CouponDiscountType,
  type CouponEligibility,
  type CouponStatus,
  type RedemptionRecord,
} from "../services/coupons.server";
import styles from "../styles/app.management.module.css";

// Settings > Rewards & Engagement > Coupons. A real, standalone campaign system — independent
// of a review triggering it (contrast Review Rewards) — backed by the Coupon/CouponRedemption
// tables and the same real Shopify discount-issuance mutation Review Rewards uses (see
// shopifyDiscount.server.ts). No decorative toggle: every control here reads/writes a real row.
type LoaderData = {
  coupons: CouponRecord[];
  /** Issued personalised codes, grouped by campaign. The service has always been able to
   *  return these; the page simply never asked, so a merchant could issue a code and then had
   *  no way to see who had received one. */
  redemptionsByCoupon: Record<string, RedemptionRecord[]>;
  storeDomain: string;
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

  // One query per campaign, in parallel, and only for campaigns that have actually issued
  // something — issuedCount is already on the record, so a store with twenty draft campaigns
  // makes no extra queries at all.
  const withIssued = coupons.filter((coupon) => coupon.issuedCount > 0);
  const redemptionLists = await Promise.all(
    withIssued.map((coupon) => couponsService.listRedemptions(store.id, coupon.id)),
  );

  const redemptionsByCoupon: Record<string, RedemptionRecord[]> = {};
  withIssued.forEach((coupon, index) => {
    redemptionsByCoupon[coupon.id] = redemptionLists[index];
  });

  return { coupons, redemptionsByCoupon, storeDomain: store.domain || session.shop };
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
        // "all" is the only mode this form currently exposes — customer selection is never
        // required to create or activate a coupon. Real "specific customers" targeting is
        // supported end-to-end in couponsService/createShopifyDiscount (see their own
        // comments) but not yet wired into this form's UI.
        customerTargeting: "all",
      });

      return { ok: true, message: "Coupon created as a draft." };
    }

    if (intent === "setStatus") {
      const id = String(formData.get("id") || "");
      const status = String(formData.get("status") || "") as Exclude<CouponStatus, "draft">;
      const storeDomain = store.domain || session.shop;

      if (status === "active") {
        await couponsService.activateCoupon(store.id, storeDomain, id);
        return { ok: true, message: "Coupon activated — a real Shopify discount code is now live." };
      }
      if (status === "paused") {
        await couponsService.pauseCoupon(store.id, storeDomain, id);
        return { ok: true, message: "Coupon paused." };
      }
      if (status === "ended") {
        await couponsService.endCoupon(store.id, storeDomain, id);
        return { ok: true, message: "Coupon ended." };
      }
      return { ok: false, error: "Invalid status." };
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

    // Revoking deactivates the real Shopify discount behind the issued code, so a code sent
    // to the wrong customer can actually be taken back. The service was already complete and
    // tested; until now nothing in the UI called it, which meant a merchant's only recourse
    // was to go and find the discount in the Shopify admin themselves.
    if (intent === "revokeRedemption") {
      const redemptionId = String(formData.get("redemptionId") || "");
      if (!redemptionId) {
        return { ok: false, error: "Missing redemption." };
      }

      const revoked = await couponsService.revokeRedemption(store.id, store.domain || session.shop, redemptionId);
      return { ok: true, message: `Code ${revoked.discountCode ?? ""} revoked.`.replace("  ", " ") };
    }

    // Asks Shopify how many times the code has actually been used at checkout, rather than
    // inferring it from anything we store. Read-only.
    if (intent === "checkUsage") {
      const code = String(formData.get("discountCode") || "").trim();
      if (!code) {
        return { ok: false, error: "This redemption has no code to check yet." };
      }

      const used = await couponsService.checkRedemptionUsage(store.domain || session.shop, code);

      if (used === null) {
        // Shopify could not answer. Saying "0 uses" here would be a fabricated fact about a
        // merchant's revenue, so the failure is reported as a failure.
        return { ok: false, error: `Shopify did not return a usage count for ${code}. Try again shortly.` };
      }

      return {
        ok: true,
        message: used === 0 ? `${code} has not been used yet.` : `${code} has been used ${used} time${used === 1 ? "" : "s"}.`,
      };
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

// Numeric id from a real Shopify GID (e.g. "gid://shopify/DiscountCodeNode/123456789") — the
// Shopify Admin discounts page URL takes the plain numeric id, not the full GID.
function discountAdminUrl(storeDomain: string, shopifyDiscountId: string): string {
  const numericId = shopifyDiscountId.split("/").pop();
  return `https://${storeDomain}/admin/discounts/${numericId}`;
}

const REDEMPTION_STATUS_TONE: Record<RedemptionRecord["status"], StatusBadgeTone> = {
  issued: "success",
  failed: "danger",
  // A merchant deliberately pulling a code back is not a failure, so it is not red.
  revoked: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });

/** Built per coupon row rather than once at module scope, so the action cells can reach the
 *  fetcher that submits them. */
function redemptionColumns(
  onRevoke: (redemptionId: string) => void,
  onCheckUsage: (discountCode: string) => void,
  busy: boolean,
): TableColumn<RedemptionRecord>[] {
  return [
  {
    key: "customerEmail",
    header: "Customer",
    width: "30%",
    render: (row) => <span className={styles.ellipsisCell}>{row.customerEmail}</span>,
  },
  {
    key: "code",
    header: "Code",
    width: "24%",
    // A real code or an em-dash. Never a placeholder: CouponRedemption.discountCode is only
    // ever set once Shopify's own mutation returned one.
    render: (row) => (row.discountCode ? <code>{row.discountCode}</code> : "—"),
  },
  {
    key: "status",
    header: "Status",
    width: "14%",
    render: (row) => (
      <StatusBadge tone={REDEMPTION_STATUS_TONE[row.status]}>{row.status}</StatusBadge>
    ),
  },
  {
    key: "createdAt",
    header: "Issued",
    width: "13%",
    align: "end",
    numeric: true,
    render: (row) => dateFormatter.format(new Date(row.createdAt)),
  },
  {
    key: "actions",
    header: "Actions",
    width: "11rem",
    headerHidden: true,
    interactive: true,
    render: (row) => (
      <div className={styles.redemptionActions}>
        {/* Only a code Shopify actually minted can be looked up or withdrawn. */}
        {row.discountCode ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onCheckUsage(row.discountCode!)}>
            Check usage
          </Button>
        ) : null}
        {row.status === "issued" ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onRevoke(row.id)}>
            Revoke
          </Button>
        ) : null}
      </div>
    ),
  },
  ];
}

function CouponRow({
  coupon,
  storeDomain,
  redemptions,
}: {
  coupon: CouponRecord;
  storeDomain: string;
  redemptions: RedemptionRecord[];
}) {
  const statusFetcher = useFetcher<ActionData>();
  const issueFetcher = useFetcher<ActionData>();
  /** Revoking a code and checking its real usage at Shopify. Its own fetcher so neither
   *  clobbers the issue form's result message. */
  const redemptionFetcher = useFetcher<ActionData>();
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    if (!coupon.discountCode) return;
    navigator.clipboard.writeText(coupon.discountCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
    <div className={`${styles.card}${coupon.status === "active" ? ` ${styles.cardAccent}` : ""}`}>
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
              {statusFetcher.state !== "idle"
                ? "Activating…"
                : coupon.shopifyDiscountId
                  ? "Resume"
                  : "Activate"}
            </Button>
          ) : null}
          {coupon.status === "active" ? (
            <Button type="button" variant="secondary" onClick={() => setStatus("paused")} disabled={statusFetcher.state !== "idle"}>
              Pause
            </Button>
          ) : null}
          {coupon.status !== "ended" ? (
            // Confirmed, because ending is the one irreversible action here: it deactivates
            // the real Shopify discount and there is no path back to active. Pause is the
            // reversible one, and is deliberately left unconfirmed.
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const message =
                  `End "${coupon.name}"?\n\n` +
                  "This deactivates the discount in Shopify and can't be undone — the campaign can't be " +
                  "reactivated afterwards. Any codes already issued from it stop working.\n\n" +
                  "To stop it temporarily instead, use Pause.";
                if (window.confirm(message)) setStatus("ended");
              }}
              disabled={statusFetcher.state !== "idle"}
            >
              End
            </Button>
          ) : null}
        </div>
      </div>

      {/* Revoke and usage-check report through their own banner — a usage count is the
          answer to a question the merchant just asked, so it must not be swallowed. */}
      {redemptionFetcher.data && !redemptionFetcher.data.ok ? (
        <Banner tone="critical" description={redemptionFetcher.data.error} />
      ) : null}
      {redemptionFetcher.data?.ok && redemptionFetcher.data.message ? (
        <Banner tone="info" description={redemptionFetcher.data.message} />
      ) : null}
      {statusFetcher.data && !statusFetcher.data.ok ? (
        <Banner tone="critical" description={statusFetcher.data.error} />
      ) : null}

      {coupon.discountCode && coupon.shopifyDiscountId ? (
        <div className={styles.inlineActions}>
          <code>{coupon.discountCode}</code>
          <Button type="button" variant="ghost" onClick={copyCode}>
            {copied ? "Copied" : "Copy code"}
          </Button>
          <a
            href={discountAdminUrl(storeDomain, coupon.shopifyDiscountId)}
            target="_blank"
            rel="noreferrer"
            className={styles.mutedText}
          >
            View in Shopify →
          </a>
        </div>
      ) : null}

      {coupon.status === "active" ? (
        <div className={styles.inlineActions}>
          <TextField
            label="Issue a separate personalized code to a customer"
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
      {issueFetcher.data && !issueFetcher.data.ok ? (
        <Banner tone="critical" description={issueFetcher.data.error} />
      ) : null}
      {issueFetcher.data?.ok && issueFetcher.data.message ? (
        <Banner tone="success" description={issueFetcher.data.message} />
      ) : null}

      {/* Issued codes. The service could always return these; the page never asked, so a
          merchant could issue a personalised code and then had no record of who received one,
          whether it worked, or whether it had been used. */}
      {redemptions.length > 0 ? (
        <details className={styles.redemptionDetails}>
          <summary className={styles.redemptionSummary}>
            {redemptions.length} issued code{redemptions.length === 1 ? "" : "s"}
          </summary>
          <Table
            rows={redemptions}
            columns={redemptionColumns(
              (redemptionId) => redemptionFetcher.submit({ intent: "revokeRedemption", redemptionId }, { method: "post" }),
              (discountCode) => redemptionFetcher.submit({ intent: "checkUsage", discountCode }, { method: "post" }),
              redemptionFetcher.state !== "idle",
            )}
            getRowKey={(row) => row.id}
            ariaLabel={`Codes issued for ${coupon.name}`}
            density="compact"
            maxHeight="18rem"
          />
        </details>
      ) : null}
    </div>
  );
}

export default function SettingsCouponsPage() {
  const { coupons, redemptionsByCoupon, storeDomain } = useLoaderData<typeof loader>();
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
              <CouponRow
                key={coupon.id}
                coupon={coupon}
                storeDomain={storeDomain}
                redemptions={redemptionsByCoupon[coupon.id] ?? []}
              />
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
