import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Frame, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import {
  cancelPaidPlan,
  ensureDevelopmentStoreFlag,
  getAllPlans,
  getBillingSnapshot,
  requestPaidPlan,
  selectStarterPlan,
  syncBillingFromShopify,
  type BillingSnapshot,
} from "../services/billing/billing.server";
import type { Plan, PlanId } from "../services/billing/plans";
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
  const { session, admin } = await authenticate.admin(request);
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

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session, admin, billing } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop);
  const isDevelopmentStore = await ensureDevelopmentStoreFlag(admin, store);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  try {
    if (intent === "select-starter") {
      await selectStarterPlan(store.id);
      return { ok: true };
    }

    if (intent === "upgrade") {
      const planId = String(formData.get("planId") || "");
      if (planId !== "growth" && planId !== "pro") {
        return { ok: false, error: "Choose a valid plan." };
      }
      // Always throws — redirects to Shopify's charge confirmation screen.
      await requestPaidPlan(billing, planId, isDevelopmentStore);
    }

    if (intent === "cancel") {
      const refreshed = await getOrCreateStore(session.shop);
      if (!refreshed.shopifySubscriptionId) {
        return { ok: false, error: "No active subscription to cancel." };
      }
      await cancelPaidPlan(billing, refreshed.shopifySubscriptionId, isDevelopmentStore);
      await selectStarterPlan(store.id);
      return { ok: true };
    }

    return { ok: false, error: "Unsupported action." };
  } catch (error) {
    // billing.request() throws a redirect Response by design — let it propagate, don't treat
    // it as an application error.
    if (error instanceof Response) {
      throw error;
    }
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update billing." };
  }
};

function formatPrice(plan: Plan) {
  return plan.price === 0 ? "Free" : `$${plan.price.toFixed(2)}/month`;
}

function PlanCard({
  plan,
  snapshot,
  onSelect,
  onCancel,
  isBusy,
}: {
  plan: Plan;
  snapshot: BillingSnapshot;
  onSelect: (planId: PlanId) => void;
  onCancel: () => void;
  isBusy: boolean;
}) {
  const isCurrent = snapshot.plan === plan.id;

  return (
    <div className={`${styles.card} ${isCurrent ? styles.cardCurrent : ""}`}>
      {isCurrent ? <p className={styles.currentBadge}>Current plan</p> : null}
      <p className={styles.planName}>{plan.name}</p>
      <p className={styles.planPrice}>{formatPrice(plan)}</p>
      <p className={styles.planTagline}>{plan.tagline}</p>
      {plan.trialDays > 0 && !isCurrent ? (
        <p className={styles.trialNote}>{plan.trialDays}-day free trial</p>
      ) : null}

      <ul className={styles.featureList}>
        {plan.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

      {isCurrent ? (
        plan.id === "starter" ? (
          <Button type="button" variant="secondary" fullWidth disabled>
            Current plan
          </Button>
        ) : (
          <Button type="button" variant="secondary" fullWidth onClick={onCancel} disabled={isBusy}>
            Downgrade to Starter
          </Button>
        )
      ) : (
        <Button type="button" variant="primary" fullWidth onClick={() => onSelect(plan.id)} disabled={isBusy}>
          {plan.id === "starter" ? "Select Starter" : `Upgrade to ${plan.name}`}
        </Button>
      )}
    </div>
  );
}

export default function BillingPage() {
  const { plans, snapshot } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isBusy = fetcher.state !== "idle";
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!fetcher.data) return;
    if (!fetcher.data.ok) {
      setToast({ content: fetcher.data.error || "Unable to update billing.", error: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const handleSelect = (planId: PlanId) => {
    const formData = new FormData();
    if (planId === "starter") {
      formData.set("_intent", "select-starter");
    } else {
      formData.set("_intent", "upgrade");
      formData.set("planId", planId);
    }
    fetcher.submit(formData, { method: "post" });
  };

  const handleCancel = () => {
    const formData = new FormData();
    formData.set("_intent", "cancel");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Container as="main">
        <div className={`${shellStyles.page} ${styles.page}`}>
          <header className={styles.header}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>Continue using Imagyn Reviews</h1>
            <p className={styles.subtitle}>
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
          </header>

          <div className={styles.grid}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                snapshot={snapshot}
                onSelect={handleSelect}
                onCancel={handleCancel}
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
