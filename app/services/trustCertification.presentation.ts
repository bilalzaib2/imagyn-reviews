import type { OverallStatus, PillarStatus, TrustCertificationSnapshot } from "./trustCertification.server";

// Real, deliberate thresholds — canonical home is here (not trustCertification.server.ts)
// specifically because these two are the only two Trust Certification constants a route's
// CLIENT-rendered component needs (for an honest progress-bar calculation) — see
// app._index.tsx / app.settings.trust.tsx. A route component importing a value from a
// `.server.ts` module pulls that entire server module (Prisma, Admin API calls) into the
// client bundle, which React Router's build correctly refuses. trustCertification.server.ts
// imports these back from here for its own internal use, so there is still exactly one
// source of truth, not two copies that could drift.
export const MIN_VERIFIED_REVIEWS = 5;
export const REVIEW_PRACTICES_THRESHOLD = 95;

// Real copy only — every string here describes a genuine PillarStatus/OverallStatus value the
// service layer can actually return, never an invented "looks nice" label. Shared between the
// Dashboard Trust & Certification card and the Settings > Trust & Certification page so the two
// surfaces can never drift into inconsistent wording for the same real state.
export const PILLAR_STATUS_LABEL: Record<PillarStatus, string> = {
  met: "Met",
  not_met: "Not met",
  pending: "Calculating",
  needs_permission: "Needs permission",
};

export type BadgeTone = "success" | "warning" | "neutral";

export const PILLAR_STATUS_TONE: Record<PillarStatus, BadgeTone> = {
  met: "success",
  not_met: "warning",
  pending: "neutral",
  needs_permission: "neutral",
};

export const OVERALL_STATUS_LABEL: Record<OverallStatus, string> = {
  certified: "Certified",
  pending: "Pending",
  at_risk: "At risk",
  paused: "Paused",
  not_certified: "Not certified",
  needs_permission: "Needs permission",
};

export const OVERALL_STATUS_TONE: Record<OverallStatus, BadgeTone> = {
  certified: "success",
  pending: "neutral",
  at_risk: "warning",
  paused: "neutral",
  not_certified: "warning",
  needs_permission: "neutral",
};

export const OVERALL_STATUS_SUMMARY: Record<OverallStatus, string> = {
  certified: "All four IMAGYN Trust pillars are genuinely met right now.",
  pending: "Still collecting the data needed to evaluate every pillar.",
  at_risk: "Previously certified, but at least one pillar is failing right now — resolve it to stay certified.",
  paused: "Certification display is paused on your storefront. Pillars keep calculating in the background.",
  not_certified: "At least one pillar is genuinely failing right now.",
  needs_permission: "Waiting on a Shopify permission before every pillar can be evaluated.",
};

export interface PillarView {
  key: string;
  title: string;
  status: PillarStatus;
  detail: string;
  actionLabel?: string;
  actionHref?: string;
  external?: boolean;
}

// Real Shopify Admin URLs for the two pillars whose fix lives outside this app entirely
// (payment provider setup, legal policy text) — built from the store's own real domain, never
// a placeholder. Nothing to link to for Store History (it's purely time-based) or a fully
// "met" pillar.
export function buildPillarViews(trust: TrustCertificationSnapshot, storeDomain: string | null): PillarView[] {
  const paymentSettingsHref = storeDomain ? `https://${storeDomain}/admin/settings/payments` : undefined;
  const legalPolicyHref = storeDomain ? `https://${storeDomain}/admin/settings/legal` : undefined;
  const { reviewPractices, paymentMethods, policy, storeHistory } = trust.pillars;

  return [
    {
      key: "reviewPractices",
      title: "Transparent Review Practices",
      status: reviewPractices.status,
      detail:
        reviewPractices.reason ??
        (reviewPractices.percent != null
          ? `${reviewPractices.percent}% of ${reviewPractices.verifiedReviewCount} verified reviews are published.`
          : "Waiting on your first verified review."),
      actionLabel:
        reviewPractices.status === "not_met"
          ? "Moderate pending reviews"
          : reviewPractices.status === "pending"
            ? "Request more reviews"
            : undefined,
      actionHref:
        reviewPractices.status === "not_met"
          ? "/app/reviews?status=PENDING"
          : reviewPractices.status === "pending"
            ? "/app/requests"
            : undefined,
    },
    {
      key: "paymentMethods",
      title: "Payment & Checkout Availability",
      status: paymentMethods.status,
      detail: paymentMethods.detail ?? "Waiting on order data.",
      actionLabel: paymentMethods.status !== "met" && paymentSettingsHref ? "Review payment settings" : undefined,
      actionHref: paymentMethods.status !== "met" ? paymentSettingsHref : undefined,
      external: true,
    },
    {
      key: "policy",
      title: "Transparent Shipping & Refund Policy",
      status: policy.status,
      detail: policy.detail ?? "Waiting on policy data.",
      actionLabel: policy.status !== "met" && legalPolicyHref ? "Edit shipping & refund policy" : undefined,
      actionHref: policy.status !== "met" ? legalPolicyHref : undefined,
      external: true,
    },
    {
      key: "storeHistory",
      title: "Verified Store History",
      status: storeHistory.status,
      detail: storeHistory.detail ?? "Waiting on store data.",
    },
  ];
}
