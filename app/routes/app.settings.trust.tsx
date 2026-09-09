import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Checkbox, Frame, Toast } from "@shopify/polaris";
import { Button } from "../components/ui/Button";
import { Section } from "../components/ui/Section";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PillarStatusIcon } from "../components/ui/PillarStatusIcon";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import {
  getOrRefreshTrustCertification,
  refreshTrustCertification,
  setTrustCertificationPaused,
} from "../services/trustCertification.server";
import {
  OVERALL_STATUS_LABEL,
  OVERALL_STATUS_SUMMARY,
  OVERALL_STATUS_TONE,
  PILLAR_STATUS_LABEL,
  PILLAR_STATUS_TONE,
  MIN_VERIFIED_REVIEWS,
  REVIEW_PRACTICES_THRESHOLD,
  buildPillarViews,
} from "../services/trustCertification.presentation";
import styles from "../styles/app.management.module.css";

// Settings > Trust & Certification — the merchant-facing control surface for the IMAGYN Trust
// Certification system (see trustCertification.server.ts for the full calculation logic). This
// page never lets a merchant set a pillar or the overall status directly; the only real control
// here is pausing/resuming *display* of an already-earned certification, plus an explicit
// recheck. See app._index.tsx's own Trust & Certification card for the Dashboard-level summary
// this page expands on.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const trust = await getOrRefreshTrustCertification(admin, store.id);

  return { storeDomain: store.domain, trust };
};

type ActionData = { ok: boolean; error?: string; message?: string };

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionData> => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "recheck-trust") {
      await refreshTrustCertification(admin, store.id);
      return { ok: true, message: "Trust Certification rechecked." };
    }

    if (intent === "toggle-pause") {
      const paused = formData.get("paused") === "true";
      await setTrustCertificationPaused(store.id, paused);
      return { ok: true, message: paused ? "Certification display paused." : "Certification display resumed." };
    }

    return { ok: false, error: "Unknown action." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update Trust Certification." };
  }
};

const formatTimestamp = (value: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );

export default function SettingsTrustPage() {
  const { storeDomain, trust } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const isBusy = fetcher.state !== "idle";
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);
  const pillarViews = buildPillarViews(trust, storeDomain);

  // Real, honest progress toward the one pillar with a genuinely gradual real ratio — see the
  // identical computation (and its own comment) in app._index.tsx's Dashboard card, which this
  // page must stay visually consistent with.
  const reviewPracticesPillar = trust.pillars.reviewPractices;
  const reviewPracticesProgress =
    reviewPracticesPillar.verifiedReviewCount < MIN_VERIFIED_REVIEWS
      ? Math.round((reviewPracticesPillar.verifiedReviewCount / MIN_VERIFIED_REVIEWS) * 100)
      : Math.min(100, Math.round(((reviewPracticesPillar.percent ?? 0) / REVIEW_PRACTICES_THRESHOLD) * 100));

  useEffect(() => {
    if (!fetcher.data) return;
    if (!fetcher.data.ok) {
      setToast({ content: fetcher.data.error || "Unable to update Trust Certification.", error: true });
      return;
    }
    setToast({ content: fetcher.data.message || "Saved." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  const handleTogglePause = (nextPaused: boolean) => {
    const formData = new FormData();
    formData.set("intent", "toggle-pause");
    formData.set("paused", String(nextPaused));
    fetcher.submit(formData, { method: "post" });
  };

  const handleRecheck = () => {
    const formData = new FormData();
    formData.set("intent", "recheck-trust");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <Section
        title="Trust & Certification"
        description="IMAGYN's real-time verification of how trustworthy your store looks to shoppers — every pillar is calculated from your real store data, never manually set. This system decides certification automatically; the only controls you have are below."
        actions={
          <Button type="button" variant="secondary" onClick={handleRecheck} disabled={isBusy}>
            {isBusy ? "Rechecking…" : "Recheck now"}
          </Button>
        }
      >
        <div className={styles.statusHero}>
          <div>
            <StatusBadge tone={OVERALL_STATUS_TONE[trust.status]}>{OVERALL_STATUS_LABEL[trust.status]}</StatusBadge>
            <p className={styles.mutedText}>{OVERALL_STATUS_SUMMARY[trust.status]}</p>
          </div>
          <span className={styles.mutedText}>Last checked {formatTimestamp(trust.lastCheckedAt)}</span>
        </div>

        <p className={styles.settingsGroupLabel}>Trust score</p>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <p className={styles.statValue}>{trust.verifiedReviewCount}</p>
            <p className={styles.statLabel}>Verified reviews</p>
          </div>
          <div className={styles.stat}>
            <p className={styles.statValue}>
              {trust.verifiedReviewCount > 0 ? trust.verifiedAverageRating.toFixed(1) : "—"}
            </p>
            <p className={styles.statLabel}>Verified average rating</p>
          </div>
        </div>

        <p className={styles.settingsGroupLabel}>Certification requirements</p>
        <div className={styles.cardList}>
          {pillarViews.map((pillar) => (
            <div key={pillar.key} className={styles.card}>
              <div className={styles.pillarRowHeader}>
                <PillarStatusIcon status={pillar.status} />
                <div className={styles.pillarRowBody}>
                  <div className={styles.cardHeader}>
                    <span>{pillar.title}</span>
                    <StatusBadge tone={PILLAR_STATUS_TONE[pillar.status]}>{PILLAR_STATUS_LABEL[pillar.status]}</StatusBadge>
                  </div>
                  {pillar.key === "reviewPractices" ? (
                    <div className={styles.pillarProgressTrack} role="presentation">
                      <div className={styles.pillarProgressFill} style={{ width: `${reviewPracticesProgress}%` }} />
                    </div>
                  ) : null}
                  <p className={styles.mutedText}>{pillar.detail}</p>
                  {pillar.actionHref ? (
                    <div className={styles.inlineActions}>
                      <a
                        href={pillar.actionHref}
                        target={pillar.external ? "_blank" : undefined}
                        rel={pillar.external ? "noreferrer" : undefined}
                      >
                        {pillar.actionLabel} &rarr;
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className={styles.settingsGroupLabel}>Storefront display</p>
        <Checkbox
          label="Pause Trust Badge and certification display on my storefront"
          checked={trust.paused}
          onChange={handleTogglePause}
          disabled={isBusy}
          helpText="Pillars keep calculating in the background while paused — this only hides the badge and certification status from shoppers. It never changes what's actually being measured."
        />
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
