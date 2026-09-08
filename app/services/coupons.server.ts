// Imagyn Reviews — Coupons: standalone promotional campaigns a merchant creates directly
// (contrast Reward, which only ever fires automatically off an approved review). Real
// Shopify discount codes via the shared shopifyDiscount.server.ts mutation — no simulated
// state; a CouponRedemption's discountCode is only ever set once Shopify's own mutation
// actually returns a real discount id.

import prisma from "../db.server";
import { createShopifyDiscount, deactivateShopifyDiscount, getShopifyDiscountUsageCount } from "./shopifyDiscount.server";

export type CouponStatus = "draft" | "active" | "paused" | "ended";
export type CouponDiscountType = "percentage" | "fixed_amount";
export type CouponEligibility = "all" | "new_customers";
export type CouponRedemptionStatus = "issued" | "failed" | "revoked";

export interface CouponInput {
  name: string;
  discountType: CouponDiscountType;
  discountValue: number;
  eligibility: CouponEligibility;
  minimumOrderAmount?: number | null;
  startsAt?: Date;
  endsAt?: Date | null;
  usageLimit?: number | null;
  perCustomerLimit: number;
}

export interface CouponRecord {
  id: string;
  name: string;
  status: CouponStatus;
  discountType: CouponDiscountType;
  discountValue: number;
  eligibility: CouponEligibility;
  minimumOrderAmount: number | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  createdAt: Date;
  updatedAt: Date;
  issuedCount: number;
}

function mapCoupon(coupon: {
  id: string;
  name: string;
  status: string;
  discountType: string;
  discountValue: number;
  eligibility: string;
  minimumOrderAmount: number | null;
  startsAt: Date;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { redemptions: number };
}): CouponRecord {
  return {
    id: coupon.id,
    name: coupon.name,
    status: coupon.status as CouponStatus,
    discountType: coupon.discountType as CouponDiscountType,
    discountValue: coupon.discountValue,
    eligibility: coupon.eligibility as CouponEligibility,
    minimumOrderAmount: coupon.minimumOrderAmount,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    usageLimit: coupon.usageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
    issuedCount: coupon._count?.redemptions ?? 0,
  };
}

export interface RedemptionRecord {
  id: string;
  couponId: string;
  customerEmail: string;
  discountCode: string | null;
  status: CouponRedemptionStatus;
  reason: string | null;
  createdAt: Date;
}

function mapRedemption(row: {
  id: string;
  couponId: string;
  customerEmail: string;
  discountCode: string | null;
  status: string;
  reason: string | null;
  createdAt: Date;
}): RedemptionRecord {
  return {
    id: row.id,
    couponId: row.couponId,
    customerEmail: row.customerEmail,
    discountCode: row.discountCode,
    status: row.status as CouponRedemptionStatus,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export class CouponNotEligibleError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CouponNotEligibleError";
  }
}

export const couponsService = {
  async listCoupons(storeId: string): Promise<CouponRecord[]> {
    const coupons = await prisma.coupon.findMany({
      where: { storeId },
      include: { _count: { select: { redemptions: { where: { status: "issued" } } } } },
      orderBy: { createdAt: "desc" },
    });

    return coupons.map(mapCoupon);
  },

  async getCoupon(storeId: string, id: string): Promise<CouponRecord | null> {
    const coupon = await prisma.coupon.findFirst({
      where: { id, storeId },
      include: { _count: { select: { redemptions: { where: { status: "issued" } } } } },
    });

    return coupon ? mapCoupon(coupon) : null;
  },

  async listRedemptions(storeId: string, couponId: string): Promise<RedemptionRecord[]> {
    const rows = await prisma.couponRedemption.findMany({
      where: { storeId, couponId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapRedemption);
  },

  async createCoupon(storeId: string, data: CouponInput): Promise<CouponRecord> {
    const created = await prisma.coupon.create({
      data: {
        storeId,
        name: data.name.trim(),
        discountType: data.discountType,
        discountValue: data.discountValue,
        eligibility: data.eligibility,
        minimumOrderAmount: data.minimumOrderAmount ?? null,
        startsAt: data.startsAt ?? new Date(),
        endsAt: data.endsAt ?? null,
        usageLimit: data.usageLimit ?? null,
        perCustomerLimit: Math.max(data.perCustomerLimit, 1),
        status: "draft",
      },
    });

    return mapCoupon({ ...created, _count: { redemptions: 0 } });
  },

  async updateCoupon(storeId: string, id: string, data: Partial<CouponInput>): Promise<CouponRecord> {
    const existing = await prisma.coupon.findFirst({ where: { id, storeId } });
    if (!existing) {
      throw new Error("Coupon not found.");
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.discountType !== undefined ? { discountType: data.discountType } : {}),
        ...(data.discountValue !== undefined ? { discountValue: data.discountValue } : {}),
        ...(data.eligibility !== undefined ? { eligibility: data.eligibility } : {}),
        ...(data.minimumOrderAmount !== undefined ? { minimumOrderAmount: data.minimumOrderAmount } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
        ...(data.usageLimit !== undefined ? { usageLimit: data.usageLimit } : {}),
        ...(data.perCustomerLimit !== undefined ? { perCustomerLimit: Math.max(data.perCustomerLimit, 1) } : {}),
      },
      include: { _count: { select: { redemptions: { where: { status: "issued" } } } } },
    });

    return mapCoupon(updated);
  },

  // "active"/"paused"/"ended" are the only transitions a merchant can make directly —
  // "draft" is exit-only (a coupon becomes active, never returns to draft), matching the
  // Reward/moderation convention in this codebase of one-directional real state machines.
  async setCouponStatus(storeId: string, id: string, status: Exclude<CouponStatus, "draft">): Promise<CouponRecord> {
    const existing = await prisma.coupon.findFirst({ where: { id, storeId } });
    if (!existing) {
      throw new Error("Coupon not found.");
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: { status },
      include: { _count: { select: { redemptions: { where: { status: "issued" } } } } },
    });

    return mapCoupon(updated);
  },

  // The one operation that talks to Shopify. Real duplicate/limit protection happens here,
  // before ever calling Shopify — the same check-then-create pattern
  // review-request.server.ts's createFromOrder already uses for its own duplicate
  // protection. Never throws into a caller that isn't specifically checking for
  // CouponNotEligibleError; any other failure is recorded on the redemption row instead
  // (mirrors evaluateAndIssueReward's own "never break the caller" convention).
  async issueRedemption(
    storeId: string,
    storeDomain: string,
    couponId: string,
    customerEmail: string,
  ): Promise<RedemptionRecord> {
    const coupon = await prisma.coupon.findFirst({ where: { id: couponId, storeId } });
    if (!coupon) {
      throw new Error("Coupon not found.");
    }

    const now = new Date();
    if (coupon.status !== "active") {
      throw new CouponNotEligibleError("This coupon is not active.");
    }
    if (coupon.startsAt > now) {
      throw new CouponNotEligibleError("This coupon has not started yet.");
    }
    if (coupon.endsAt && coupon.endsAt < now) {
      throw new CouponNotEligibleError("This coupon has ended.");
    }

    const email = customerEmail.trim().toLowerCase();

    if (coupon.usageLimit !== null) {
      const totalIssued = await prisma.couponRedemption.count({
        where: { couponId, status: "issued" },
      });
      if (totalIssued >= coupon.usageLimit) {
        throw new CouponNotEligibleError("This coupon has reached its usage limit.");
      }
    }

    const customerIssuedCount = await prisma.couponRedemption.count({
      where: { couponId, customerEmail: email, status: "issued" },
    });
    if (customerIssuedCount >= coupon.perCustomerLimit) {
      throw new CouponNotEligibleError("This customer has already redeemed this coupon.");
    }

    const code = generateCouponCode(coupon.name);

    const result = await createShopifyDiscount(storeDomain, {
      title: `${coupon.name} — ${code}`,
      code,
      valueType: coupon.discountType as CouponDiscountType,
      value: coupon.discountValue,
      appliesOncePerCustomer: coupon.perCustomerLimit === 1,
      ...(coupon.minimumOrderAmount !== null ? { minimumSubtotal: coupon.minimumOrderAmount } : {}),
      ...(coupon.endsAt ? { endsAt: coupon.endsAt } : {}),
    });

    if (!result.ok) {
      const failed = await prisma.couponRedemption.create({
        data: { storeId, couponId, customerEmail: email, status: "failed", reason: result.error },
      });
      return mapRedemption(failed);
    }

    const created = await prisma.couponRedemption.create({
      data: {
        storeId,
        couponId,
        customerEmail: email,
        discountCode: code,
        shopifyDiscountId: result.discountId,
        status: "issued",
      },
    });

    return mapRedemption(created);
  },

  // Revokes a still-unused code — real Shopify deactivation, not just a local status flip.
  async revokeRedemption(storeId: string, storeDomain: string, redemptionId: string): Promise<RedemptionRecord> {
    const existing = await prisma.couponRedemption.findFirst({ where: { id: redemptionId, storeId } });
    if (!existing) {
      throw new Error("Redemption not found.");
    }
    if (existing.status !== "issued") {
      throw new Error("Only an issued redemption can be revoked.");
    }

    if (existing.shopifyDiscountId) {
      const result = await deactivateShopifyDiscount(storeDomain, existing.shopifyDiscountId);
      if (!result.ok) {
        throw new Error(result.error);
      }
    }

    const updated = await prisma.couponRedemption.update({
      where: { id: redemptionId },
      data: { status: "revoked" },
    });

    return mapRedemption(updated);
  },

  // Real, live redemption signal — asks Shopify directly whether the issued code has
  // actually been used at checkout (asyncUsageCount), rather than inferring it locally.
  // Read-only; never changes stored state on its own.
  async checkRedemptionUsage(storeDomain: string, discountCode: string): Promise<number | null> {
    return getShopifyDiscountUsageCount(storeDomain, discountCode);
  },
};

function generateCouponCode(name: string): string {
  const prefix = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 10)
    .toUpperCase() || "COUPON";
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${random}`;
}
