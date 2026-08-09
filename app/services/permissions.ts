// The single source of truth for "what is this store allowed to do." Every gate in the app —
// routes, services, UI — reads a boolean off Permissions instead of comparing PlanId strings
// directly. This is deliberate: a plan's *name* can change (rename, merge, retire) and a
// merchant's *entitlement* can be granted outside the normal plan ladder (Owner, and later
// Lifetime/Beta/Enterprise/Partner) without touching a single call site, because call sites
// never know what plan they're looking at — only what the store can do.
//
// Adding a new plan (e.g. "lifetime") is: one entry in PERMISSIONS_BY_PLAN here, nothing else.
// Adding a new gated capability is: one field on Permissions, one line per plan here, one
// reader at the call site. No plan-name branching anywhere outside this file.
import { getStorePlanId } from "./billing/billing.server";
import type { PlanId } from "./billing/plans";

export interface Permissions {
  // null = unlimited.
  maxPublishedReviews: number | null;

  canImportCSV: boolean;
  // Starter's import is real but subject to the same maxPublishedReviews ceiling as manual
  // submissions (see review.server.ts's createReview) — this flag is purely descriptive of
  // that fact for pricing copy, not a second enforcement point.
  canImportUnlimitedCSV: boolean;

  canUseManualReviewRequests: boolean;
  canUseAutomaticReviewRequests: boolean;
  canUseEmailReminders: boolean;

  // Email Studio's single review-request template editor (subject/content/variables/CTA/
  // logo/preview/reset) has no gate at all — every plan gets it, see app.email-studio.tsx.
  // This flag is specifically the Pro-only extension: multiple templates/themes, a
  // reminder-email template, and deeper layout/styling control — none of which is built yet,
  // same "entitlement true, comingSoon on every pricing surface" convention as
  // canUseVideoReviews below.
  canUseAdvancedEmailStudio: boolean;

  canUsePhotoReviews: boolean;
  canUseVideoReviews: boolean;

  canUseAI: boolean;
  canUseAnalytics: boolean;

  canUseCustomBranding: boolean;
  canUseBrandStudio: boolean;
  canUseMultipleWidgetThemes: boolean;
  canUseWhiteLabel: boolean;

  canUseCustomEmailDomain: boolean;
  canUseSMTP: boolean;
  canUseAPI: boolean;
  canUseWebhooks: boolean;

  hasUnlimitedTeamMembers: boolean;
  hasPrioritySupport: boolean;
  hasPremiumSupport: boolean;
}

// Thrown by any gate below when a store lacks a capability — the one shape every caller
// catches, same convention the old PlanLimitError established. `requiredPlan` drives the
// upgrade prompt (see components/ui/UpgradePrompt.tsx) rather than the message alone, so the
// UI can render a real "Upgrade to Growth" action instead of parsing text.
export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly requiredPlan: PlanId,
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

// Free tier. Per the 2026 pricing restructure: Starter includes unlimited reviews/requests,
// automated initial review-request emails, photo/video reviews, imports, and core analytics —
// PRO (Growth/Scale) is reserved for advanced/AI/automation/analytics and deeper customization
// (Brand Studio, custom branding, multiple widget themes) rather than core functionality.
const STARTER: Permissions = {
  maxPublishedReviews: null,
  canImportCSV: true,
  canImportUnlimitedCSV: true,
  canUseManualReviewRequests: true,
  // Entitlement true — the scheduled-dispatch sweep (reviewRequestScheduler.server.ts) means a
  // "scheduled" request now genuinely sends automatically regardless of plan. The one remaining
  // gate is external, not plan-based: order-triggered *creation* stays off app-wide via
  // ORDER_AUTOMATION_ENABLED (config/features.ts) until Shopify approves the fulfillments/create
  // webhook's Protected Customer Data access — see webhooks.fulfillments.create.tsx.
  canUseAutomaticReviewRequests: true,
  // Follow-up reminder emails (a distinct, not-yet-built feature) stay a PRO differentiator —
  // see plans.ts's Growth features.
  canUseEmailReminders: false,
  canUseAdvancedEmailStudio: false,
  canUsePhotoReviews: true,
  // Entitlement true; video review upload itself isn't built yet (no enforcement point exists
  // anywhere in the codebase) — plans.ts still marks this comingSoon on every tier until it is.
  canUseVideoReviews: true,
  canUseAI: false,
  // Entitlement true; every plan already renders the same dashboard (app._index.tsx) — there is
  // no differentiated "advanced" analytics built yet for Growth to exclusively offer.
  canUseAnalytics: true,
  canUseCustomBranding: false,
  canUseBrandStudio: false,
  canUseMultipleWidgetThemes: false,
  canUseWhiteLabel: false,
  canUseCustomEmailDomain: false,
  canUseSMTP: false,
  canUseAPI: false,
  canUseWebhooks: false,
  hasUnlimitedTeamMembers: false,
  hasPrioritySupport: false,
  hasPremiumSupport: false,
};

const GROWTH: Permissions = {
  ...STARTER,
  canUseEmailReminders: true,
  canUseAdvancedEmailStudio: true,
  canUseAI: true,
  canUseCustomBranding: true,
  canUseBrandStudio: true,
  canUseMultipleWidgetThemes: true,
  hasPrioritySupport: true,
};

const SCALE: Permissions = {
  ...GROWTH,
  // None of the four below have any enforcement point in the codebase yet — entitlement is
  // true so Scale stores get them automatically the day each ships; plans.ts marks all four
  // "Coming soon" on every pricing surface until then.
  canUseVideoReviews: true,
  canUseWhiteLabel: true,
  canUseCustomEmailDomain: true,
  canUseSMTP: true,
  canUseAPI: true,
  canUseWebhooks: true,
  hasUnlimitedTeamMembers: true,
  hasPremiumSupport: true,
};

const OWNER: Permissions = {
  maxPublishedReviews: null,
  canImportCSV: true,
  canImportUnlimitedCSV: true,
  canUseManualReviewRequests: true,
  canUseAutomaticReviewRequests: true,
  canUseEmailReminders: true,
  canUseAdvancedEmailStudio: true,
  canUsePhotoReviews: true,
  canUseVideoReviews: true,
  canUseAI: true,
  canUseAnalytics: true,
  canUseCustomBranding: true,
  canUseBrandStudio: true,
  canUseMultipleWidgetThemes: true,
  canUseWhiteLabel: true,
  canUseCustomEmailDomain: true,
  canUseSMTP: true,
  canUseAPI: true,
  canUseWebhooks: true,
  hasUnlimitedTeamMembers: true,
  hasPrioritySupport: true,
  hasPremiumSupport: true,
};

const PERMISSIONS_BY_PLAN: Record<PlanId, Permissions> = {
  starter: STARTER,
  growth: GROWTH,
  scale: SCALE,
  owner: OWNER,
};

export function getPermissions(plan: PlanId): Permissions {
  return PERMISSIONS_BY_PLAN[plan];
}

// Convenience for services that only have a storeId on hand (aiSummary.server.ts,
// reviewMedia.server.ts, review.server.ts, review-request.server.ts, webhooks) and need a
// gating decision without loading the full billing snapshot the admin UI uses.
export async function getStorePermissions(storeId: string): Promise<Permissions> {
  const plan = await getStorePlanId(storeId);
  return getPermissions(plan);
}

export function assertPermission(
  permissions: Permissions,
  feature: {
    [K in keyof Permissions]: Permissions[K] extends boolean ? K : never;
  }[keyof Permissions],
  message: string,
  requiredPlan: PlanId,
) {
  if (!permissions[feature]) {
    throw new PermissionError(message, requiredPlan);
  }
}
