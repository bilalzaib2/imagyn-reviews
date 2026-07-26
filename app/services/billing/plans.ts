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
  // The remaining flags describe entitlements that are part of the commercial plan
  // definition but have no enforcement point in the app yet (no email-customization UI,
  // no video upload, no multi-template system, no branding controls beyond the existing
  // Appearance system, no support-priority mechanism, no public API). They're listed here so
  // the pricing page is accurate and so enforcement can be added later without renegotiating
  // what each plan is supposed to include.
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
      "Automatic review requests",
      "AI review summaries",
      "Photo reviews",
      "Email customization",
      "Advanced widget customization",
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
    tagline: "Full control for high-volume stores.",
    features: [
      "Everything in Growth",
      "Video reviews",
      "Multiple email templates",
      "Advanced branding controls",
      "Priority support",
      "Future API/integration features",
    ],
    limits: {
      maxPublishedReviews: null,
      automaticReviewRequests: true,
      aiSummaries: true,
      photoReviews: true,
      emailCustomization: true,
      advancedWidgetCustomization: true,
      videoReviews: true,
      multipleEmailTemplates: true,
      advancedBranding: true,
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
