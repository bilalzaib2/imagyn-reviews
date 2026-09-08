// Imagyn Reviews — Referrals: a customer shares a real Shopify discount code (their
// "referral code"); once a new customer's real order actually uses it, this app detects
// that from Shopify's own order data and issues the referrer their own reward. Deliberately
// does NOT add a new webhook subscription — orders/create would face the exact same
// protected-customer-data webhook-subscription approval gate fulfillments/create already
// did (see docs/DECISIONS.md). Instead, conversion detection queries real orders by discount
// code via the Admin GraphQL API, using scopes (read_orders) already granted today.

import prisma from "../db.server";
import { createShopifyDiscount } from "./shopifyDiscount.server";

export interface ReferralProgramSettings {
  enabled: boolean;
  referrerValueType: "percentage" | "fixed_amount";
  referrerValue: number;
  refereeValueType: "percentage" | "fixed_amount";
  refereeValue: number;
  minimumOrderAmount: number | null;
}

export async function getReferralProgram(storeId: string): Promise<ReferralProgramSettings> {
  const program = await prisma.referralProgram.findUnique({ where: { storeId } });

  if (!program) {
    return {
      enabled: false,
      referrerValueType: "percentage",
      referrerValue: 10,
      refereeValueType: "percentage",
      refereeValue: 10,
      minimumOrderAmount: null,
    };
  }

  return {
    enabled: program.enabled,
    referrerValueType: program.referrerValueType as "percentage" | "fixed_amount",
    referrerValue: program.referrerValue,
    refereeValueType: program.refereeValueType as "percentage" | "fixed_amount",
    refereeValue: program.refereeValue,
    minimumOrderAmount: program.minimumOrderAmount,
  };
}

export async function updateReferralProgram(storeId: string, data: ReferralProgramSettings): Promise<void> {
  await prisma.referralProgram.upsert({
    where: { storeId },
    update: {
      enabled: data.enabled,
      referrerValueType: data.referrerValueType,
      referrerValue: data.referrerValue,
      refereeValueType: data.refereeValueType,
      refereeValue: data.refereeValue,
      minimumOrderAmount: data.minimumOrderAmount,
    },
    create: {
      storeId,
      enabled: data.enabled,
      referrerValueType: data.referrerValueType,
      referrerValue: data.referrerValue,
      refereeValueType: data.refereeValueType,
      refereeValue: data.refereeValue,
      minimumOrderAmount: data.minimumOrderAmount,
    },
  });
}

export interface ReferralRecord {
  id: string;
  referrerEmail: string;
  referrerName: string | null;
  code: string;
  createdAt: Date;
  conversionCount: number;
  rewardedCount: number;
}

function mapReferral(row: {
  id: string;
  referrerEmail: string;
  referrerName: string | null;
  code: string;
  createdAt: Date;
  conversions: Array<{ status: string }>;
}): ReferralRecord {
  return {
    id: row.id,
    referrerEmail: row.referrerEmail,
    referrerName: row.referrerName,
    code: row.code,
    createdAt: row.createdAt,
    conversionCount: row.conversions.length,
    rewardedCount: row.conversions.filter((c) => c.status === "rewarded").length,
  };
}

function generateReferralCode(referrerName: string | null): string {
  const base = (referrerName || "FRIEND").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase() || "FRIEND";
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}${random}`;
}

export const referralsService = {
  async listReferrals(storeId: string): Promise<ReferralRecord[]> {
    const rows = await prisma.referral.findMany({
      where: { storeId },
      include: { conversions: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapReferral);
  },

  // Creates the referrer's shareable code as a real Shopify discount — usageLimit is
  // deliberately left unlimited (many different friends can use the same code) but
  // appliesOncePerCustomer stays true, so no single referee can redeem it twice.
  async createReferral(
    storeId: string,
    storeDomain: string,
    referrerEmail: string,
    referrerName: string | null,
  ): Promise<ReferralRecord> {
    const program = await getReferralProgram(storeId);
    if (!program.enabled) {
      throw new Error("Referrals are turned off.");
    }

    const code = generateReferralCode(referrerName);

    const result = await createShopifyDiscount(storeDomain, {
      title: `Referral — ${referrerName || referrerEmail}`,
      code,
      valueType: program.refereeValueType,
      value: program.refereeValue,
      appliesOncePerCustomer: true,
      ...(program.minimumOrderAmount !== null ? { minimumSubtotal: program.minimumOrderAmount } : {}),
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    const created = await prisma.referral.create({
      data: {
        storeId,
        referrerEmail: referrerEmail.trim().toLowerCase(),
        referrerName: referrerName?.trim() || null,
        code,
        shopifyDiscountId: result.discountId,
      },
      include: { conversions: { select: { status: true } } },
    });

    return mapReferral(created);
  },

  // The real conversion-detection step: queries Shopify for orders that actually used this
  // referral's discount code (Admin GraphQL `orders(query: "discount_code:...")`), using the
  // already-granted read_orders/read_customers scopes — no new webhook, no new approval.
  // Idempotent per order: ReferralConversion rows are keyed by shopifyOrderId, so re-running
  // this for the same referral never double-counts or double-rewards an order already seen.
  async syncReferralConversions(storeId: string, storeDomain: string, referralId: string): Promise<{ newConversions: number; rewarded: number }> {
    const referral = await prisma.referral.findFirst({ where: { id: referralId, storeId } });
    if (!referral) {
      throw new Error("Referral not found.");
    }

    const program = await getReferralProgram(storeId);

    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(storeDomain);

    const response = await admin.graphql(ORDERS_BY_DISCOUNT_CODE_QUERY, {
      variables: { query: `discount_code:${referral.code}` },
    });
    const json = (await response.json()) as OrdersByDiscountCodeResponse;
    const orders = json.data?.orders?.edges ?? [];

    let newConversions = 0;
    let rewarded = 0;

    for (const { node: order } of orders) {
      const existing = await prisma.referralConversion.findFirst({
        where: { referralId, shopifyOrderId: order.id },
      });
      if (existing) {
        continue;
      }

      const refereeEmail = order.customer?.email ?? null;
      const conversion = await prisma.referralConversion.create({
        data: {
          storeId,
          referralId,
          refereeEmail,
          shopifyOrderId: order.id,
          status: "qualified",
        },
      });
      newConversions += 1;

      // Reward the referrer for this specific conversion — a real discount code per
      // qualifying order, never a guess at "how many times to reward."
      const code = generateReferralCode(referral.referrerName);
      const result = await createShopifyDiscount(storeDomain, {
        title: `Referral reward — ${referral.referrerEmail}`,
        code,
        valueType: program.referrerValueType,
        value: program.referrerValue,
        usageLimit: 1,
        appliesOncePerCustomer: true,
      });

      if (result.ok) {
        await prisma.referralConversion.update({
          where: { id: conversion.id },
          data: { status: "rewarded", referrerDiscountCode: code, referrerRewardIssuedAt: new Date() },
        });
        rewarded += 1;
      } else {
        await prisma.referralConversion.update({
          where: { id: conversion.id },
          data: { reason: result.error },
        });
      }
    }

    return { newConversions, rewarded };
  },
};

interface OrdersByDiscountCodeResponse {
  data?: {
    orders?: {
      edges: Array<{
        node: {
          id: string;
          customer?: { email: string | null } | null;
        };
      }>;
    };
  };
}

const ORDERS_BY_DISCOUNT_CODE_QUERY = `#graphql
  query OrdersByDiscountCode($query: String!) {
    orders(first: 50, query: $query) {
      edges {
        node {
          id
          customer {
            email
          }
        }
      }
    }
  }
`;
