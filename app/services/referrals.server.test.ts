// Exercises referrals.server.ts's real discount-issuance and conversion-detection flow —
// no real database, no real Shopify API call (unauthenticated.admin is mocked).
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProgram {
  storeId: string;
  enabled: boolean;
  referrerValueType: string;
  referrerValue: number;
  refereeValueType: string;
  refereeValue: number;
  minimumOrderAmount: number | null;
}

interface FakeReferral {
  id: string;
  storeId: string;
  referrerEmail: string;
  referrerName: string | null;
  code: string;
  shopifyDiscountId: string | null;
  createdAt: Date;
}

interface FakeConversion {
  id: string;
  storeId: string;
  referralId: string;
  refereeEmail: string | null;
  shopifyOrderId: string | null;
  status: string;
  reason: string | null;
  referrerDiscountCode: string | null;
  referrerRewardIssuedAt: Date | null;
}

let programs: FakeProgram[];
let referrals: FakeReferral[];
let conversions: FakeConversion[];
let nextId: number;

let ordersResult: Array<{ id: string; customer: { email: string | null } | null }> = [];
let discountShouldFail = false;

const graphqlMock = vi.fn(async (query: string) => ({
  json: async () => {
    if (query.includes("OrdersByDiscountCode")) {
      return { data: { orders: { edges: ordersResult.map((node) => ({ node })) } } };
    }
    if (query.includes("DiscountCodeBasicCreate")) {
      if (discountShouldFail) {
        return { data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ field: null, message: "Discount limit reached" }] } } };
      }
      return {
        data: {
          discountCodeBasicCreate: { codeDiscountNode: { id: `gid://shopify/DiscountCodeNode/${nextId++}` }, userErrors: [] },
        },
      };
    }
    return { data: {} };
  },
}));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: vi.fn(async () => ({ admin: { graphql: graphqlMock } })),
  },
}));

vi.mock("../db.server", () => ({
  default: {
    referralProgram: {
      findUnique: vi.fn(async ({ where }: { where: { storeId: string } }) => programs.find((p) => p.storeId === where.storeId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { storeId: string }; create: FakeProgram; update: Partial<FakeProgram> }) => {
        const existing = programs.find((p) => p.storeId === where.storeId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        programs.push(create);
        return create;
      }),
    },
    referral: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) =>
        referrals.find((r) => r.id === where.id && r.storeId === where.storeId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { storeId: string } }) => referrals.filter((r) => r.storeId === where.storeId)),
      create: vi.fn(async ({ data }: { data: Partial<FakeReferral> & { storeId: string; referrerEmail: string; code: string } }) => {
        const referral: FakeReferral = {
          id: `referral_${nextId++}`,
          referrerName: null,
          shopifyDiscountId: null,
          createdAt: new Date(),
          ...data,
        };
        referrals.push(referral);
        return { ...referral, conversions: [] };
      }),
    },
    referralConversion: {
      findFirst: vi.fn(async ({ where }: { where: { referralId: string; shopifyOrderId: string } }) =>
        conversions.find((c) => c.referralId === where.referralId && c.shopifyOrderId === where.shopifyOrderId) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Partial<FakeConversion> & { storeId: string; referralId: string } }) => {
        const conversion: FakeConversion = {
          id: `conversion_${nextId++}`,
          refereeEmail: null,
          shopifyOrderId: null,
          reason: null,
          referrerDiscountCode: null,
          referrerRewardIssuedAt: null,
          status: "pending",
          ...data,
        };
        conversions.push(conversion);
        return conversion;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeConversion> }) => {
        const conversion = conversions.find((c) => c.id === where.id);
        if (!conversion) throw new Error("Conversion not found");
        Object.assign(conversion, data);
        return conversion;
      }),
    },
  },
}));

const { referralsService, getReferralProgram, updateReferralProgram } = await import("./referrals.server");

beforeEach(() => {
  programs = [];
  referrals = [];
  conversions = [];
  nextId = 1;
  ordersResult = [];
  discountShouldFail = false;
  graphqlMock.mockClear();
});

describe("getReferralProgram", () => {
  it("returns sensible defaults when no program row exists yet", async () => {
    const settings = await getReferralProgram("store_1");
    expect(settings.enabled).toBe(false);
    expect(settings.referrerValue).toBe(10);
  });
});

describe("createReferral", () => {
  it("refuses when the program is disabled", async () => {
    programs.push({
      storeId: "store_1",
      enabled: false,
      referrerValueType: "percentage",
      referrerValue: 10,
      refereeValueType: "percentage",
      refereeValue: 10,
      minimumOrderAmount: null,
    });
    await expect(referralsService.createReferral("store_1", "shop.myshopify.com", "a@example.com", "Alice")).rejects.toThrow(/turned off/i);
  });

  it("issues a real discount code and creates a referral row when enabled", async () => {
    programs.push({
      storeId: "store_1",
      enabled: true,
      referrerValueType: "percentage",
      referrerValue: 10,
      refereeValueType: "percentage",
      refereeValue: 15,
      minimumOrderAmount: null,
    });
    const referral = await referralsService.createReferral("store_1", "shop.myshopify.com", "a@example.com", "Alice");
    expect(referral.code).toBeTruthy();
    expect(referral.referrerEmail).toBe("a@example.com");
    expect(referral.conversionCount).toBe(0);
  });
});

describe("syncReferralConversions", () => {
  beforeEach(() => {
    programs.push({
      storeId: "store_1",
      enabled: true,
      referrerValueType: "percentage",
      referrerValue: 10,
      refereeValueType: "percentage",
      refereeValue: 15,
      minimumOrderAmount: null,
    });
    referrals.push({
      id: "referral_1",
      storeId: "store_1",
      referrerEmail: "a@example.com",
      referrerName: "Alice",
      code: "ALICE123",
      shopifyDiscountId: "1",
      createdAt: new Date(),
    });
  });

  it("does nothing when no real orders used the code", async () => {
    ordersResult = [];
    const result = await referralsService.syncReferralConversions("store_1", "shop.myshopify.com", "referral_1");
    expect(result.newConversions).toBe(0);
    expect(result.rewarded).toBe(0);
  });

  it("creates a conversion and rewards the referrer for a new real order", async () => {
    ordersResult = [{ id: "gid://shopify/Order/1", customer: { email: "friend@example.com" } }];
    const result = await referralsService.syncReferralConversions("store_1", "shop.myshopify.com", "referral_1");
    expect(result.newConversions).toBe(1);
    expect(result.rewarded).toBe(1);
    expect(conversions[0].status).toBe("rewarded");
    expect(conversions[0].refereeEmail).toBe("friend@example.com");
  });

  it("never double-counts an order it has already recorded", async () => {
    ordersResult = [{ id: "gid://shopify/Order/1", customer: { email: "friend@example.com" } }];
    await referralsService.syncReferralConversions("store_1", "shop.myshopify.com", "referral_1");
    const result = await referralsService.syncReferralConversions("store_1", "shop.myshopify.com", "referral_1");
    expect(result.newConversions).toBe(0);
    expect(conversions).toHaveLength(1);
  });

  it("records the conversion without rewarding when the referrer's discount creation fails", async () => {
    ordersResult = [{ id: "gid://shopify/Order/1", customer: { email: "friend@example.com" } }];
    // First call creates the referral's own code successfully (in createReferral, not used
    // here), but the reward-issuance call inside sync should fail:
    discountShouldFail = true;
    const result = await referralsService.syncReferralConversions("store_1", "shop.myshopify.com", "referral_1");
    expect(result.newConversions).toBe(1);
    expect(result.rewarded).toBe(0);
    expect(conversions[0].status).toBe("qualified");
    expect(conversions[0].reason).toMatch(/limit reached/i);
  });
});

describe("updateReferralProgram", () => {
  it("creates a program row when none exists", async () => {
    await updateReferralProgram("store_1", {
      enabled: true,
      referrerValueType: "fixed_amount",
      referrerValue: 5,
      refereeValueType: "percentage",
      refereeValue: 20,
      minimumOrderAmount: 25,
    });
    expect(programs).toHaveLength(1);
    expect(programs[0].enabled).toBe(true);
  });
});
