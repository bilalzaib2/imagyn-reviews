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

const STARTER: Permissions = {
  maxPublishedReviews: 50,
  canImportCSV: true,
  canImportUnlimitedCSV: false,
  canUseManualReviewRequests: true,
  canUseAutomaticReviewRequests: false,
  canUseEmailReminders: false,
  canUsePhotoReviews: false,
  canUseVideoReviews: false,
  canUseAI: false,
  canUseAnalytics: false,
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
  maxPublishedReviews: null,
  canImportUnlimitedCSV: true,
  // Entitlement is true — Growth is the plan that includes this. Whether it's actually live
  // today is a separate, build-status question (see plans.ts's `comingSoon` tags: both of
  // these are currently gated off app-wide by ORDER_AUTOMATION_ENABLED pending Shopify's
  // Protected Customer Data approval, config/features.ts). Keeping the entitlement true means
  // the moment that approval lands and the flag flips, every Growth+ store already has access
  // — no plan-data migration needed.
  canUseAutomaticReviewRequests: true,
  canUseEmailReminders: true,
  canUsePhotoReviews: true,
  canUseAI: true,
  // Entitlement true; no differentiated "advanced" analytics exists yet beyond the dashboard
  // every plan already sees (app._index.tsx) — see plans.ts's comingSoon tag.
  canUseAnalytics: true,
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
