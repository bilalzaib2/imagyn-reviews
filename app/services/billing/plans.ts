// Plan metadata — price, trial length, and the copy shown on the pricing page. This is
// display data only: what a plan is *allowed to do* lives in permissions.ts, keyed off the
// same PlanId, and every gate in the app reads permissions, never this file, directly (see
// permissions.ts's header comment for why). app.billing.tsx and every marketing/App-Store
// surface read `features` from here so "what does Growth include" only ever has one answer
// inside this repo.
//
// "owner" is a real PlanId (see permissions.ts) but is deliberately excluded from PLAN_ORDER /
// getAllPlans() below — it must never render on the pricing page, in Shopify's billing config,
// on the website, or in the App Store listing. It exists purely so a Store row can carry
// `plan: "owner"` and have permissions.ts grant it everything, with no billing subscription and
// no plan-name checks anywhere else in the app (see billing.server.ts's getBillingSnapshot).
export type PlanId = "starter" | "growth" | "scale" | "owner";

export interface PlanFeature {
  label: string;
  // True only for features with zero enforcement point in the codebase today. Per the
  // 2026 pre-launch truthfulness pass: a feature is only ever shown as included (no tag) if
  // it is genuinely built and usable right now — never on the strength of "the plan is
  // supposed to include this eventually." Check permissions.ts's per-flag comments before
  // flipping this; it must be updated everywhere this feature is listed (app billing page,
  // website pricing page, App Store listing) the moment real code lands.
  comingSoon?: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  currencyCode: string;
  trialDays: number;
  tagline: string;
  features: PlanFeature[];
}

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 0,
    currencyCode: "USD",
    trialDays: 0,
    tagline: "Everything you need to start collecting reviews.",
    features: [
      { label: "Up to 50 reviews" },
      { label: "Manual review requests" },
      { label: "Basic review widgets" },
      { label: "Basic moderation" },
      { label: "Email notifications" },
      { label: "Verified buyer badge" },
      { label: "CSV import (limited)" },
      { label: "Community support" },
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 9.99,
    currencyCode: "USD",
    trialDays: 14,
    tagline: "For stores actively growing customer trust.",
    features: [
      { label: "Everything in Starter" },
      { label: "Unlimited reviews" },
      { label: "Unlimited CSV imports" },
      // Both gated off by ORDER_AUTOMATION_ENABLED (config/features.ts) pending Shopify's
      // Protected Customer Data approval — the entitlement exists (permissions.ts) but the
      // trigger itself isn't live for any store yet, so this can't be shown as included.
      { label: "Automatic review requests", comingSoon: true },
      { label: "Automatic email reminders", comingSoon: true },
      { label: "AI review summaries" },
      { label: "Photo reviews" },
      // No differentiated analytics beyond the dashboard every plan already sees.
      { label: "Advanced analytics", comingSoon: true },
      { label: "Custom branding" },
      { label: "Multiple widget themes" },
      { label: "Brand Studio" },
      { label: "Priority support" },
    ],
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 29.99,
    currencyCode: "USD",
    trialDays: 14,
    tagline: "For high-volume stores that need white-label control.",
    features: [
      { label: "Everything in Growth" },
      { label: "Video reviews", comingSoon: true },
      { label: "White label", comingSoon: true },
      { label: "Custom email domain (SMTP, Resend, Postmark)", comingSoon: true },
      { label: "API access", comingSoon: true },
      { label: "Webhooks", comingSoon: true },
      { label: "Unlimited team members", comingSoon: true },
      { label: "Premium support" },
    ],
  },
  // Not a billable plan — see the file header. Metadata below exists only so getPlan("owner")
  // doesn't need a special case; nothing reads these fields for an owner-plan store.
  owner: {
    id: "owner",
    name: "Owner",
    price: 0,
    currencyCode: "USD",
    trialDays: 0,
    tagline: "Internal — every permission enabled, no billing.",
    features: [],
  },
};

// The only plans that may ever appear on the pricing page, in Shopify's billing config, on
// the website, or in the App Store listing. Deliberately omits "owner".
export const PLAN_ORDER: PlanId[] = ["starter", "growth", "scale"];

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

export function getAllPlans(): Plan[] {
  return PLAN_ORDER.map(getPlan);
}
