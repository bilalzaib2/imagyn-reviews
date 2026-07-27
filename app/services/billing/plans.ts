// Single source of truth for every plan's price, trial length, and entitlements — the pricing
// page (app.billing.tsx) and every feature gate in the app (review.server.ts,
// aiSummary.server.ts, reviewMedia.server.ts, review-request.server.ts) read from this file
// instead of hardcoding plan comparisons, so "what does Growth include" only ever has one
// answer. Shopify's billing config in shopify.server.ts also derives its prices from here.
export type PlanId = "starter" | "growth" | "pro";

export interface PlanLimits {
  // null = unlimited.
  maxPublishedReviews: number | null;
  automaticReviewRequests: boolean;
  aiSummaries: boolean;
  photoReviews: boolean;
  // V1 launch truthfulness pass: none of these six have an enforcement point in the app
  // (no email-customization UI, Brand Studio is available to every plan including Starter
  // so it isn't a Growth/Pro differentiator, no video upload, no multi-template system, no
  // support-priority mechanism, no public API) — none of them are shown on the pricing
  // page anymore. Left here, unenforced, as reserved future entitlements rather than
  // deleted, so a real feature built later can flip the matching flag without renegotiating
  // what each plan is supposed to include. Do not add any of these back to a plan's
  // `features` array until it is actually true.
  emailCustomization: boolean;
  advancedWidgetCustomization: boolean;
  videoReviews: boolean;
  multipleEmailTemplates: boolean;
  advancedBranding: boolean;
  prioritySupport: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  currencyCode: string;
  trialDays: number;
  tagline: string;
  features: string[];
  limits: PlanLimits;
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
      "Up to 50 published reviews",
      "Manual review requests",
      "Basic review widget",
      "Standard email template",
      "Basic moderation",
    ],
    limits: {
      maxPublishedReviews: 50,
      automaticReviewRequests: false,
      aiSummaries: false,
      photoReviews: false,
      emailCustomization: false,
      advancedWidgetCustomization: false,
      videoReviews: false,
      multipleEmailTemplates: false,
      advancedBranding: false,
      prioritySupport: false,
    },
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 9.99,
    currencyCode: "USD",
    trialDays: 14,
    tagline: "For stores actively growing customer trust.",
    features: [
      "Unlimited reviews",
      "Automatic review requests (activating after Shopify's pending approval)",
      "AI review summaries",
      "Photo reviews",
      "Branded review request emails",
    ],
    limits: {
      maxPublishedReviews: null,
      automaticReviewRequests: true,
      aiSummaries: true,
      photoReviews: true,
      emailCustomization: true,
      advancedWidgetCustomization: true,
      videoReviews: false,
      multipleEmailTemplates: false,
      advancedBranding: false,
      prioritySupport: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 29.99,
    currencyCode: "USD",
    trialDays: 14,
    tagline: "Priority support for high-volume stores.",
    // Every claim here must have a real enforcement point or be a genuinely deliverable
    // operational commitment — see the "V1 launch truthfulness pass" audit in
    // docs/DECISIONS.md. "Video reviews", "Multiple email templates", "Advanced branding
    // controls" and "Future API/integration features" were removed: none of them exist
    // anywhere in the app, so listing them would be a false claim on a paid tier — the
    // kind of mismatch that can get an app rejected (or worse, refunded after the fact)
    // during Shopify App Store review. "Priority support" stays: it's a real, deliverable
    // support-response commitment that doesn't require any app functionality to honor.
    features: ["Everything in Growth", "Priority support", "Early access to new features"],
    limits: {
      maxPublishedReviews: null,
      automaticReviewRequests: true,
      aiSummaries: true,
      photoReviews: true,
      emailCustomization: true,
      advancedWidgetCustomization: true,
      videoReviews: false,
      multipleEmailTemplates: false,
      advancedBranding: false,
      prioritySupport: true,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ["starter", "growth", "pro"];

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}

export function planRank(id: PlanId): number {
  return PLAN_ORDER.indexOf(id);
}

export function meetsMinimumPlan(current: PlanId, minimum: PlanId): boolean {
  return planRank(current) >= planRank(minimum);
}
