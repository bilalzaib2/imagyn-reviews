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

import { randomBytes } from "node:crypto";
import prisma from "../db.server";
import { emailTemplateService } from "./emailTemplate.server";
import { resolveSenderIdentity } from "./emailSenderIdentity.server";
import { getStorePermissions } from "./permissions";
import { buildReviewRequestEmail } from "./notifications/templates.server";
import { getEmailProvider } from "./notifications/provider.server";
import { createShopifyDiscount } from "./shopifyDiscount.server";

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

// Crockford-style alphabet: no I, L, O or U, so a code read off a screen or an order insert
// cannot be mistyped into a different valid-looking one.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

// A discount code is a bearer token for real money off the merchant's products, so it has to be
// unguessable and fixed-length. `Math.random().toString(36).slice(2, 8)` was neither: Math.random
// is not a CSPRNG, and the slice yields FEWER than six characters whenever the random value's
// string form is short (0.5 -> "0.i" -> "I"), which could emit a one-character code.
function generateDiscountCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `THANKS-${code}`;
}

// A "pending" Reward is a claim taken but not yet resolved. The window between claiming and
// Shopify answering is ~1s, so anything still pending well past that is from a process that
// died mid-flight. Same lease idea as the scheduler's STALE_CLAIM_MS, and generous enough that
// it can never race a genuinely in-flight attempt.
const PENDING_CLAIM_STALE_MS = 15 * 60 * 1000;

function isStalePendingClaim(reward: { status: string; updatedAt: Date }, now: Date): boolean {
  return reward.status === "pending" && reward.updatedAt.getTime() < now.getTime() - PENDING_CLAIM_STALE_MS;
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
// Idempotency/duplicate-prevention: Reward.reviewId is a hard unique DB constraint, and the row
// is now created as a "pending" CLAIM before the Shopify mutation rather than as a result after
// it. That ordering is the point — the constraint protects the row, but only a claim taken
// first protects the external side effect. See the comment at the claim itself.
export async function evaluateAndIssueReward(input: RewardEvaluationInput): Promise<void> {
  const now = new Date();
  const existing = await prisma.reward.findUnique({ where: { reviewId: input.reviewId } });
  // issued / failed / ineligible are terminal: this review's reward is decided. Only an
  // abandoned claim is allowed through, so a crash between claiming and Shopify responding
  // cannot strand the reward forever.
  if (existing && !isStalePendingClaim(existing, now)) {
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

  // THE CLAIM, taken before the Shopify mutation rather than after it.
  //
  // The findUnique at the top of this function is a check, not a lock. setReviewStatus fires
  // `void issueRewardIfEligible(...)` on every transition to APPROVED, so a double-click in the
  // admin, two moderators, or an approve/reject/approve sequence runs this concurrently — and
  // with a real database round trip in between (getRewardSettings), both callers observed "no
  // row" and both reached discountCodeBasicCreate. The reviewId unique constraint protected the
  // Reward ROW, so only one survived, but TWO live discount codes had already been created in
  // the merchant's Shopify admin, the second one orphaned and never emailed.
  //
  // Same shape, and same remedy, as the scheduler's dispatch claim: let the database decide the
  // winner before anything external happens. A loser here simply stops.
  const claimed = existing
    ? // Re-taking an abandoned claim. Predicated on it still being pending AND still stale, so
      // two recoveries racing each other still yield exactly one winner — the write itself
      // refreshes updatedAt, which renews the lease.
      (
        await prisma.reward.updateMany({
          where: {
            reviewId: input.reviewId,
            status: "pending",
            updatedAt: { lt: new Date(now.getTime() - PENDING_CLAIM_STALE_MS) },
          },
          data: { valueType: settings.valueType, value: settings.value },
        })
      ).count === 1
    : await prisma.reward
        .create({
          data: {
            storeId: input.storeId,
            reviewId: input.reviewId,
            status: "pending",
            valueType: settings.valueType,
            value: settings.value,
          },
        })
        .then(() => true)
        .catch(() => false);

  if (!claimed) {
    // Lost the race. The winner owns this review's reward.
    return;
  }

  try {
    const result = await createShopifyDiscount(input.storeDomain, {
      title: `Review reward — ${code}`,
      code,
      valueType: settings.valueType,
      value: settings.value,
      // A real, Shopify-enforced abuse guard — not just our own DB uniqueness — so the same
      // code can never be redeemed more than once by anyone, on top of one Reward row ever
      // existing per review.
      usageLimit: 1,
      appliesOncePerCustomer: true,
    });

    if (!result.ok) {
      await prisma.reward
        .update({
          where: { reviewId: input.reviewId },
          data: {
            status: "failed",
            reason: result.error,
          },
        })
        .catch(() => {});
      return;
    }

    // The claim row already exists; promote it rather than inserting a second one.
    await prisma.reward.update({
      where: { reviewId: input.reviewId },
      data: {
        status: "issued",
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
      // The reward email is a customer-facing send like any other, so it gets the same
      // sender identity and the same shared Email Branding. It previously passed the raw
      // store name as fromName and no Reply-To at all, which meant a Pro merchant's branded
      // sender name silently did not apply here and a reply to a reward landed on the shared
      // platform address rather than in their inbox.
      const store = await prisma.store.findUnique({
        where: { id: input.storeId },
        select: { name: true, emailSenderName: true, emailLogoUrl: true, emailLogoDarkUrl: true },
      });
      const senderIdentity = resolveSenderIdentity(
        { name: store?.name ?? input.storeName, emailSenderName: store?.emailSenderName ?? null },
        await getStorePermissions(input.storeId),
        template.replyToEmail,
      );

      const { subject, html, text } = await buildReviewRequestEmail({
        customerName: input.customerName,
        productName: input.productName,
        storeName: input.storeName,
        reviewUrl: `https://${input.storeDomain}`,
        customMessage: null,
        template,
        branding: store,
        discountCode: code,
      });

      await getEmailProvider().sendEmail({
        to: input.customerEmail,
        subject,
        html,
        text,
        fromName: senderIdentity.displayName,
        ...(senderIdentity.replyTo ? { replyTo: senderIdentity.replyTo } : {}),
        tags: { reward_review_id: input.reviewId },
      });
    } catch (emailError) {
      // The discount is real and stays issued — that status is the truth about the discount,
      // and rolling it back would invalidate a code the customer may already hold. What was
      // missing is any trace that the customer never actually received it: the row read as a
      // delivered reward, so a merchant chasing "I never got my code" had nothing to go on.
      // Recorded on `reason`, which needs no schema change and leaves getRewardStats's
      // issued/pending/failed/ineligible counts meaning exactly what they meant before.
      const detail = emailError instanceof Error ? emailError.message : "Unknown error";
      console.error(`[rewards] Reward issued but email failed for review ${input.reviewId}:`, emailError);
      await prisma.reward
        .update({
          where: { reviewId: input.reviewId },
          data: { reason: `Discount issued, but the reward email could not be delivered: ${detail}` },
        })
        .catch(() => {});
    }
  } catch (error) {
    console.error(`[rewards] Failed to issue reward for review ${input.reviewId}:`, error);
    // The claim row exists by this point, so this updates it rather than inserting a duplicate.
    await prisma.reward
      .update({
        where: { reviewId: input.reviewId },
        data: {
          status: "failed",
          reason: error instanceof Error ? error.message : "Unknown error",
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
