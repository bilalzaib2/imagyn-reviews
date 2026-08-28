import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useLocation, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Frame, Toast } from "@shopify/polaris";
import { Container } from "../components/ui/Container";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  ensureDevelopmentStoreFlag,
  getAllPlans,
  getBillingSnapshot,
  selectStarterPlan,
  syncBillingFromShopify,
  type BillingSnapshot,
} from "../services/billing/billing.server";
import type { Plan } from "../services/billing/plans";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.billing.module.css";

type LoaderData = {
  plans: Plan[];
  snapshot: BillingSnapshot;
};

type ActionData = {
  ok: boolean;
  error?: string;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  await ensureDevelopmentStoreFlag(admin, store);
  // Live reconciliation every time this page loads — it's a low-traffic page (visited to pick
  // or change a plan, not on every app navigation), so a real Admin API round-trip here is
  // cheap and keeps the plan-selection UI honest even if Shopify's side changed since the
  // last webhook (e.g. a merchant cancelled directly from Shopify's own subscription screen).
  await syncBillingFromShopify(admin, store);

  const refreshed = await getOrCreateStore(session.shop);

  return {
    plans: getAllPlans(),
    snapshot: getBillingSnapshot(refreshed),
  };
};

// The paid plan (Pro) is never created or cancelled from here — Shopify Managed Pricing
// owns that entire flow on its own hosted page (see app.billing.manage.tsx). The only action
// this route still performs itself is Starter, because it's a local, no-Shopify-charge choice
// (see selectStarterPlan) rather than a Billing API operation.
export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  if (intent === "select-starter") {
    await selectStarterPlan(store.id);
    return { ok: true };
  }

  return { ok: false, error: "Unsupported action." };
};

function formatPrice(plan: Plan) {
  return plan.price === 0 ? "Free" : `$${plan.price.toFixed(2)}/month`;
}

function PlanCard({
  plan,
  snapshot,
  manageUrl,
  onSelectStarter,
  isBusy,
}: {
  plan: Plan;
  snapshot: BillingSnapshot;
  manageUrl: string;
  onSelectStarter: () => void;
  isBusy: boolean;
}) {
  // hasAccess is required here, not just a plan-id match: a brand-new store defaults to
  // plan: "starter" before the merchant has ever made a choice (planStatus stays "pending"
  // until they do), so plan alone would mark Starter "current" and disable its own button —
  // permanently locking a fresh install out of the one plan that doesn't need Shopify billing.
  const isCurrent = snapshot.hasAccess && snapshot.plan === plan.id;
  const isPopular = plan.id === "growth" && !isCurrent;

  return (
    <div
      className={`${styles.card} ${isCurrent ? styles.cardCurrent : ""} ${isPopular ? styles.cardPopular : ""}`}
    >
      <div className={styles.badgeSlot}>
        {isPopular ? <p className={styles.popularBadge}>Most popular</p> : null}
        {isCurrent ? <p className={styles.currentBadge}>Current plan</p> : null}
      </div>
      <p className={styles.planName}>{plan.name}</p>
      <p className={styles.planPrice}>{formatPrice(plan)}</p>
      <p className={styles.planTagline}>{plan.tagline}</p>
      {plan.trialDays > 0 && !isCurrent ? (
        <p className={styles.trialNote}>{plan.trialDays}-day free trial</p>
      ) : null}

      <ul className={styles.featureList}>
        {plan.features.map((feature) => (
          <li key={feature.label} className={feature.comingSoon ? styles.featureComingSoon : undefined}>
            {feature.label}
            {feature.comingSoon ? <span className={styles.comingSoonTag}>Coming soon</span> : null}
          </li>
        ))}
      </ul>

      {plan.id === "starter" ? (
        <button
          type="button"
          onClick={onSelectStarter}
          disabled={isBusy || isCurrent}
          className={`${styles.cardAction} ${isCurrent ? styles.ctaSecondary : styles.ctaPrimary}`}
        >
          {isCurrent ? "Current plan" : "Select Free"}
        </button>
      ) : isCurrent ? (
        // Downgrading is also Shopify's to manage under Managed Pricing — same hosted page,
        // where picking a lower (or no) plan is just another selection.
        <a href={manageUrl} className={`${styles.cardAction} ${styles.ctaSecondary}`}>
          Downgrade to Free
        </a>
      ) : (
        // Paid plans are never requested from app code — Shopify Managed Pricing hosts the
        // actual purchase/confirmation screen; this only navigates the merchant there.
        <a href={manageUrl} className={`${styles.cardAction} ${styles.ctaPrimary}`}>
          Upgrade to {plan.name}
        </a>
      )}
    </div>
  );
}

export default function BillingPage() {
  const { plans, snapshot } = useLoaderData<typeof loader>();
  const location = useLocation();
  const fetcher = useFetcher<ActionData>();
  const isBusy = fetcher.state !== "idle";
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  // Carries embedded/host/shop context to the manage route the same way app.tsx's own nav
  // links do — it's a plain top-level navigation (required to break out of the iframe), not a
  // fetcher, so it needs that context in its own URL rather than inheriting it from a POST.
  const manageUrl = `/app/billing/manage${location.search}`;

  useEffect(() => {
    if (!fetcher.data) return;
    if (!fetcher.data.ok) {
      setToast({ content: fetcher.data.error || "Unable to update billing.", error: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const handleSelectStarter = () => {
    const formData = new FormData();
    formData.set("_intent", "select-starter");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Container as="main">
        <div className={shellStyles.page}>
          <header className={shellStyles.header}>
            <div className={shellStyles.headerContent}>
              <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
              <h1 className={shellStyles.title}>Continue using Imagyn Reviews</h1>
              <p className={shellStyles.subtitle}>
                Choose a plan to continue collecting reviews, sending review requests, and growing customer trust.
              </p>
              {snapshot.isDevelopmentStore ? (
                <p className={styles.devNote}>Development store — billing is bypassed automatically.</p>
              ) : null}
              {snapshot.isTrialing && snapshot.trialEndsAt ? (
                <p className={styles.trialBanner}>
                  Free trial active — ends {new Date(snapshot.trialEndsAt).toLocaleDateString()}.
                </p>
              ) : null}
              {snapshot.planStatus === "frozen" ? (
                <p className={styles.frozenBanner}>
                  Your subscription is on hold. Update your billing details in Shopify to restore access.
                </p>
              ) : null}
            </div>
          </header>

          <div className={styles.grid}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                snapshot={snapshot}
                manageUrl={manageUrl}
                onSelectStarter={handleSelectStarter}
                isBusy={isBusy}
              />
            ))}
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
