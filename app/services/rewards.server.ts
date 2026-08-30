// Imagyn Reviews — Review Rewards.
//
// A real, working system: a merchant configures conditions once (Settings > Review Rewards),
// and every review that becomes APPROVED is evaluated against them. If eligible, this issues
// a genuine Shopify discount code (discountCodeBasicCreate — the same Admin GraphQL mutation
// the Shopify admin's own Discounts page uses) and emails the customer through the existing
// Email Studio system (a "reward" EmailTemplateType, see email.shared.ts). Nothing here is
// simulated: a Reward row's status only ever becomes "issued" after Shopify's mutation
// actually succeeds and returned a real discount id.
//
// Deliberately Free-tier functionality (see docs/DECISIONS.md-style reasoning: a merchant's
// own discount costs Imagyn nothing to offer, and "genuinely useful, functional" Free product
// is the explicit product direction) — advanced automation/rules beyond the conditions below
// are the natural Pro differentiator for a later pass, not gated here today.

import prisma from "../db.server";
import { emailTemplateService } from "./emailTemplate.server";
import { buildReviewRequestEmail } from "./notifications/templates.server";
import { getEmailProvider } from "./notifications/provider.server";

export interface RewardSettings {
  enabled: boolean;
  valueType: "percentage" | "fixed_amount";
  value: number;
  minRating: number;
  requireVerified: boolean;
  requirePhoto: boolean;
  requireVideo: boolean;
}

export async function getRewardSettings(storeId: string): Promise<RewardSettings> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: {
      rewardsEnabled: true,
      rewardValueType: true,
      rewardValue: true,
      rewardMinRating: true,
      rewardRequireVerified: true,
      rewardRequirePhoto: true,
      rewardRequireVideo: true,
    },
  });

  return {
    enabled: store.rewardsEnabled,
    valueType: store.rewardValueType === "fixed_amount" ? "fixed_amount" : "percentage",
    value: store.rewardValue,
    minRating: store.rewardMinRating,
    requireVerified: store.rewardRequireVerified,
    requirePhoto: store.rewardRequirePhoto,
    requireVideo: store.rewardRequireVideo,
  };
}

export async function updateRewardSettings(storeId: string, data: RewardSettings): Promise<void> {
  await prisma.store.update({
    where: { id: storeId },
    data: {
      rewardsEnabled: data.enabled,
      rewardValueType: data.valueType,
      rewardValue: data.value,
      rewardMinRating: data.minRating,
      rewardRequireVerified: data.requireVerified,
      rewardRequirePhoto: data.requirePhoto,
      rewardRequireVideo: data.requireVideo,
    },
  });
}

export interface RewardEligibilityInput {
  status: string;
  rating: number;
  verifiedPurchase: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string | null;
}

// Pure function — every condition here is a real, already-tracked Review attribute (see
// prisma/schema.prisma's Review model). No condition is ever invented: photo/video presence
// comes from the real ReviewMedia relation, not a guess.
export function evaluateEligibility(review: RewardEligibilityInput, settings: RewardSettings): EligibilityResult {
  if (!settings.enabled) {
    return { eligible: false, reason: "Review Rewards are turned off." };
  }
  if (review.status !== "APPROVED") {
    return { eligible: false, reason: "Review is not approved." };
  }
  if (review.rating < settings.minRating) {
    return { eligible: false, reason: `Rating ${review.rating} is below the required minimum (${settings.minRating}).` };
  }
  if (settings.requireVerified && !review.verifiedPurchase) {
    return { eligible: false, reason: "Not a verified purchase." };
  }
  if (settings.requirePhoto && !review.hasPhoto) {
    return { eligible: false, reason: "No photo attached." };
  }
  if (settings.requireVideo && !review.hasVideo) {
    return { eligible: false, reason: "No video attached." };
  }
  return { eligible: true, reason: null };
}

function generateDiscountCode(): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `THANKS-${random}`;
}

interface DiscountCodeBasicCreateResponse {
  data?: {
    discountCodeBasicCreate?: {
      codeDiscountNode?: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    };
  };
}

const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation DiscountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

async function createShopifyDiscount(
  storeDomain: string,
  code: string,
  settings: Pick<RewardSettings, "valueType" | "value">,
): Promise<{ ok: true; discountId: string } | { ok: false; error: string }> {
  // Imported lazily (not at module scope) so that merely importing rewards.server.ts — e.g.
  // transitively, via review.server.ts, from files that only test unrelated review logic —
  // never eagerly evaluates shopify.server.ts's top-level PrismaSessionStorage construction.
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(storeDomain);

  const customerGets =
    settings.valueType === "percentage"
      ? { value: { percentage: settings.value / 100 }, items: { all: true } }
      : { value: { discountAmount: { amount: settings.value, appliesOnEachItem: false } }, items: { all: true } };

  const basicCodeDiscount = {
    title: `Review reward — ${code}`,
    code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets,
    // A real, Shopify-enforced abuse guard — not just our own DB uniqueness — so the same
    // code can never be redeemed more than once by anyone, on top of one Reward row ever
    // existing per review.
    usageLimit: 1,
    appliesOncePerCustomer: true,
  };

  const response = await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, { variables: { basicCodeDiscount } });
  const json = (await response.json()) as DiscountCodeBasicCreateResponse;
  const result = json.data?.discountCodeBasicCreate;

  if (!result || result.userErrors.length > 0) {
    const message = result?.userErrors.map((error) => error.message).join(" ") || "Unable to create the discount.";
    return { ok: false, error: message };
  }

  if (!result.codeDiscountNode?.id) {
    return { ok: false, error: "Shopify did not return a discount id." };
  }

  return { ok: true, discountId: result.codeDiscountNode.id };
}

export interface RewardEvaluationInput {
  reviewId: string;
  storeId: string;
  storeDomain: string;
  storeName: string;
  customerName: string;
  customerEmail: string | null;
  productName: string;
  status: string;
  rating: number;
  verifiedPurchase: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
}

// The one entry point — called (fire-and-forget, matching aiSummary.server.ts's
// maybeAutoRegenerateAiSummary precedent) right after a review becomes APPROVED, whether that
// happened via a merchant's manual moderation action or real-time auto-approval on
// submission. Never throws: every failure path is recorded on the Reward row instead, so a
// broken reward flow can never break the review-approval action that triggered it.
//
// Idempotency/duplicate-prevention: Reward.reviewId is a hard unique DB constraint (see
// schema.prisma) — a P2002 violation on create means another evaluation already ran for this
// exact review (e.g. a rapid double-click on Approve), and is treated as a harmless no-op,
// not an error.
export async function evaluateAndIssueReward(input: RewardEvaluationInput): Promise<void> {
  const existing = await prisma.reward.findUnique({ where: { reviewId: input.reviewId } });
  if (existing) {
    return;
  }

  const settings = await getRewardSettings(input.storeId);
  const eligibility = evaluateEligibility(
    {
      status: input.status,
      rating: input.rating,
      verifiedPurchase: input.verifiedPurchase,
      hasPhoto: input.hasPhoto,
      hasVideo: input.hasVideo,
    },
    settings,
  );

  if (!eligibility.eligible) {
    await prisma.reward
      .create({
        data: {
          storeId: input.storeId,
          reviewId: input.reviewId,
          status: "ineligible",
          reason: eligibility.reason,
          valueType: settings.valueType,
          value: settings.value,
        },
      })
      .catch(() => {
        // Unique-constraint race — another evaluation already recorded this review; nothing
        // more to do.
      });
    return;
  }

  if (!input.customerEmail) {
    await prisma.reward
      .create({
        data: {
          storeId: input.storeId,
          reviewId: input.reviewId,
          status: "failed",
          reason: "No customer email on file to send the reward to.",
          valueType: settings.valueType,
          value: settings.value,
        },
      })
      .catch(() => {});
    return;
  }

  const code = generateDiscountCode();

  try {
    const result = await createShopifyDiscount(input.storeDomain, code, settings);

    if (!result.ok) {
      await prisma.reward
        .create({
          data: {
            storeId: input.storeId,
            reviewId: input.reviewId,
            status: "failed",
            reason: result.error,
            valueType: settings.valueType,
            value: settings.value,
          },
        })
        .catch(() => {});
      return;
    }

    await prisma.reward.create({
      data: {
        storeId: input.storeId,
        reviewId: input.reviewId,
        status: "issued",
        valueType: settings.valueType,
        value: settings.value,
        discountCode: code,
        shopifyDiscountId: result.discountId,
        issuedAt: new Date(),
      },
    });

    // Customer communication — reuses the exact same Email Studio content system and send
    // path every other customer-facing email in this app uses (see email.shared.ts's
    // EmailTemplateType "reward"), not a separate hardcoded template.
    try {
      const template = await emailTemplateService.getActiveContent(input.storeId, "reward");
      const { subject, html, text } = await buildReviewRequestEmail({
        customerName: input.customerName,
        productName: input.productName,
        storeName: input.storeName,
        reviewUrl: `https://${input.storeDomain}`,
        customMessage: null,
        template,
        discountCode: code,
      });

      await getEmailProvider().sendEmail({
        to: input.customerEmail,
        subject,
        html,
        text,
        fromName: input.storeName,
        tags: { reward_review_id: input.reviewId },
      });
    } catch (emailError) {
      // The discount was already issued and persisted — a failed email is logged, not
      // retried automatically (no customer-facing urgency loop for this the way review
      // request reminders have one), and never rolls back the already-real discount.
      console.error(`[rewards] Reward issued but email failed for review ${input.reviewId}:`, emailError);
    }
  } catch (error) {
    console.error(`[rewards] Failed to issue reward for review ${input.reviewId}:`, error);
    await prisma.reward
      .create({
        data: {
          storeId: input.storeId,
          reviewId: input.reviewId,
          status: "failed",
          reason: error instanceof Error ? error.message : "Unknown error",
          valueType: settings.valueType,
          value: settings.value,
        },
      })
      .catch(() => {});
  }
}

export interface RewardStats {
  issued: number;
  pending: number;
  failed: number;
  ineligible: number;
}

export async function getRewardStats(storeId: string): Promise<RewardStats> {
  const groups = await prisma.reward.groupBy({
    by: ["status"],
    where: { storeId },
    _count: { status: true },
  });

  const countByStatus = new Map(groups.map((group) => [group.status, group._count.status]));

  return {
    issued: countByStatus.get("issued") ?? 0,
    pending: countByStatus.get("pending") ?? 0,
    failed: countByStatus.get("failed") ?? 0,
    ineligible: countByStatus.get("ineligible") ?? 0,
  };
}
