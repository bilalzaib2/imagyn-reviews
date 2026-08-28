// Plan metadata — price, trial length, and the copy shown on the pricing page. This is
// display data only: what a plan is *allowed to do* lives in permissions.ts, keyed off the
// same PlanId, and every gate in the app reads permissions, never this file, directly (see
// permissions.ts's header comment for why). app.billing.tsx and every marketing/App-Store
// surface read `features` from here so "what does Pro include" only ever has one answer
// inside this repo.
//
// The product is locked to exactly two merchant-facing plans, Free and Pro (see PLAN_ORDER
// below) — "starter" and "growth" are the internal identifiers behind those two names.
// "scale" and "owner" both remain real PlanId values (permissions.ts still resolves them, and
// billing.server.ts's syncBillingFromShopify can still map an existing Shopify subscription
// onto "scale") but neither is ever selectable or shown again: "owner" is purely internal (a
// Store row can carry `plan: "owner"` and have permissions.ts grant it everything, with no
// billing subscription and no plan-name checks anywhere else in the app — see
// billing.server.ts's getBillingSnapshot), and "scale" is a retired third tier kept only so a
// merchant who was already subscribed to it before this change keeps their current
// entitlements (identical to Pro's today — see permissions.ts's SCALE) instead of being
// silently downgraded.
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
    name: "Free",
    price: 0,
    currencyCode: "USD",
    trialDays: 0,
    tagline: "Everything you need to start collecting reviews — free, no limits on the core.",
    features: [
      { label: "Unlimited reviews" },
      { label: "Unlimited review requests" },
      // Delivered by reviewRequestScheduler.server.ts's sweep for any request that reaches
      // "scheduled" (today: manually created with a delay). Order-triggered *creation* of that
      // scheduled request is a separate, external gate — see permissions.ts's STARTER comment.
      { label: "Automated initial review-request emails" },
      { label: "Email Studio — customize your review-request email" },
      { label: "Photo reviews" },
      { label: "Video reviews" },
      { label: "Review widgets & rating badges" },
      { label: "Moderation & merchant replies" },
      { label: "Unlimited CSV imports" },
      { label: "Verified buyer badge" },
      { label: "Helpful voting" },
      { label: "Core analytics" },
      { label: "SEO structured data" },
      { label: "Community support" },
    ],
  },
  growth: {
    id: "growth",
    name: "Pro",
    price: 9.99,
    currencyCode: "USD",
    trialDays: 14,
    tagline: "For stores that want AI, deeper automation, and full brand control.",
    features: [
      { label: "Everything in Starter" },
      { label: "AI review summaries" },
      { label: "Automatic email reminders (3 & 7 days)" },
      { label: "Multiple email templates & reminder emails" },
      { label: "Advanced email styling", comingSoon: true },
      // No differentiated analytics beyond the dashboard every plan already sees.
      { label: "Advanced analytics", comingSoon: true },
      { label: "Custom branding" },
      { label: "Multiple widget themes" },
      { label: "Brand Studio" },
      { label: "Priority support" },
    ],
  },
  // Retired third tier — excluded from PLAN_ORDER, so getAllPlans()/the billing page never
  // render it. Kept defined only for existing subscribers; see PlanId's own comment above.
  scale: {
    id: "scale",
    name: "Scale",
    price: 29.99,
    currencyCode: "USD",
    trialDays: 14,
    tagline: "For high-volume stores that need white-label control.",
    features: [
      { label: "Everything in Growth" },
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
// the website, or in the App Store listing — exactly Free and Pro, per the product's locked
// two-plan positioning. Deliberately omits "owner" (internal-only, see plans.owner below) and
// "scale" (retired from the merchant-facing surface; see PlanId's own comment for why the
// identifier itself is kept around rather than deleted).
export const PLAN_ORDER: PlanId[] = ["starter", "growth"];

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

export function getAllPlans(): Plan[] {
  return PLAN_ORDER.map(getPlan);
}
