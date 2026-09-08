// Exercises coupons.server.ts's real eligibility/duplicate-protection logic and the
// issuance/revocation flow around it — no real database, no real Shopify API call
// (unauthenticated.admin is mocked, same convention as rewards.server.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeCoupon {
  id: string;
  storeId: string;
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
}

interface FakeRedemption {
  id: string;
  storeId: string;
  couponId: string;
  customerEmail: string;
  discountCode: string | null;
  shopifyDiscountId: string | null;
  status: string;
  reason: string | null;
  createdAt: Date;
}

let coupons: FakeCoupon[];
let redemptions: FakeRedemption[];
let nextId: number;

let graphqlResult: "success" | "userError" | "noNode" = "success";

const graphqlMock = vi.fn(async (query: string) => ({
  json: async () => {
    if (query.includes("DiscountCodeBasicCreate")) {
      if (graphqlResult === "userError") {
        return { data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ field: null, message: "Code already exists" }] } } };
      }
      if (graphqlResult === "noNode") {
        return { data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [] } } };
      }
      return {
        data: {
          discountCodeBasicCreate: {
            codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" },
            userErrors: [],
          },
        },
      };
    }
    if (query.includes("DiscountCodeDeactivate")) {
      return { data: { discountCodeDeactivate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" }, userErrors: [] } } };
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
    coupon: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) =>
        coupons.find((c) => c.id === where.id && c.storeId === where.storeId) ?? null,
      ),
    },
    couponRedemption: {
      count: vi.fn(async ({ where }: { where: { couponId: string; status: string; customerEmail?: string } }) =>
        redemptions.filter(
          (r) => r.couponId === where.couponId && r.status === where.status && (where.customerEmail ? r.customerEmail === where.customerEmail : true),
        ).length,
      ),
      create: vi.fn(async ({ data }: { data: Partial<FakeRedemption> & { storeId: string; couponId: string; customerEmail: string } }) => {
        const redemption: FakeRedemption = {
          id: `redemption_${nextId++}`,
          discountCode: null,
          shopifyDiscountId: null,
          status: "issued",
          reason: null,
          createdAt: new Date(),
          ...data,
        };
        redemptions.push(redemption);
        return redemption;
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; storeId: string } }) =>
        redemptions.find((r) => r.id === where.id && r.storeId === where.storeId) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeRedemption> }) => {
        const redemption = redemptions.find((r) => r.id === where.id);
        if (!redemption) throw new Error("Redemption not found");
        Object.assign(redemption, data);
        return redemption;
      }),
    },
  },
}));

const { couponsService, CouponNotEligibleError } = await import("./coupons.server");

function baseCoupon(overrides: Partial<FakeCoupon> = {}): FakeCoupon {
  return {
    id: "coupon_1",
    storeId: "store_1",
    name: "Summer Sale",
    status: "active",
    discountType: "percentage",
    discountValue: 15,
    eligibility: "all",
    minimumOrderAmount: null,
    startsAt: new Date(Date.now() - 1000 * 60 * 60),
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  coupons = [];
  redemptions = [];
  nextId = 1;
  graphqlResult = "success";
  graphqlMock.mockClear();
});

describe("issueRedemption — eligibility guards", () => {
  it("rejects a non-active coupon", async () => {
    coupons.push(baseCoupon({ status: "paused" }));
    await expect(couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "a@example.com")).rejects.toThrow(
      CouponNotEligibleError,
    );
  });

  it("rejects a coupon that hasn't started yet", async () => {
    coupons.push(baseCoupon({ startsAt: new Date(Date.now() + 1000 * 60 * 60) }));
    await expect(couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "a@example.com")).rejects.toThrow(
      /not started/i,
    );
  });

  it("rejects an ended coupon", async () => {
    coupons.push(baseCoupon({ endsAt: new Date(Date.now() - 1000 * 60 * 60) }));
    await expect(couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "a@example.com")).rejects.toThrow(
      /ended/i,
    );
  });

  it("rejects once the total usage limit is reached", async () => {
    coupons.push(baseCoupon({ usageLimit: 1 }));
    redemptions.push({
      id: "r1",
      storeId: "store_1",
      couponId: "coupon_1",
      customerEmail: "existing@example.com",
      discountCode: "X",
      shopifyDiscountId: "1",
      status: "issued",
      reason: null,
      createdAt: new Date(),
    });
    await expect(couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "new@example.com")).rejects.toThrow(
      /usage limit/i,
    );
  });

  it("rejects a repeat redemption from the same customer at perCustomerLimit 1", async () => {
    coupons.push(baseCoupon({ perCustomerLimit: 1 }));
    redemptions.push({
      id: "r1",
      storeId: "store_1",
      couponId: "coupon_1",
      customerEmail: "a@example.com",
      discountCode: "X",
      shopifyDiscountId: "1",
      status: "issued",
      reason: null,
      createdAt: new Date(),
    });
    await expect(couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "a@example.com")).rejects.toThrow(
      CouponNotEligibleError,
    );
  });

  it("allows a second redemption from the same customer when perCustomerLimit is 2", async () => {
    coupons.push(baseCoupon({ perCustomerLimit: 2 }));
    redemptions.push({
      id: "r1",
      storeId: "store_1",
      couponId: "coupon_1",
      customerEmail: "a@example.com",
      discountCode: "X",
      shopifyDiscountId: "1",
      status: "issued",
      reason: null,
      createdAt: new Date(),
    });
    const result = await couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "a@example.com");
    expect(result.status).toBe("issued");
  });
});

describe("issueRedemption — real issuance", () => {
  it("creates a real discount code and an issued redemption row on success", async () => {
    coupons.push(baseCoupon());
    const result = await couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "A@Example.com");
    expect(result.status).toBe("issued");
    expect(result.discountCode).toBeTruthy();
    expect(result.customerEmail).toBe("a@example.com");
  });

  it("records a failed redemption when Shopify returns a userError, without throwing", async () => {
    coupons.push(baseCoupon());
    graphqlResult = "userError";
    const result = await couponsService.issueRedemption("store_1", "shop.myshopify.com", "coupon_1", "a@example.com");
    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/already exists/i);
  });
});

describe("revokeRedemption", () => {
  it("deactivates the real Shopify discount and marks the redemption revoked", async () => {
    coupons.push(baseCoupon());
    redemptions.push({
      id: "r1",
      storeId: "store_1",
      couponId: "coupon_1",
      customerEmail: "a@example.com",
      discountCode: "X",
      shopifyDiscountId: "gid://shopify/DiscountCodeNode/1",
      status: "issued",
      reason: null,
      createdAt: new Date(),
    });
    const result = await couponsService.revokeRedemption("store_1", "shop.myshopify.com", "r1");
    expect(result.status).toBe("revoked");
  });

  it("refuses to revoke a redemption that isn't currently issued", async () => {
    redemptions.push({
      id: "r1",
      storeId: "store_1",
      couponId: "coupon_1",
      customerEmail: "a@example.com",
      discountCode: "X",
      shopifyDiscountId: "1",
      status: "revoked",
      reason: null,
      createdAt: new Date(),
    });
    await expect(couponsService.revokeRedemption("store_1", "shop.myshopify.com", "r1")).rejects.toThrow(/only an issued/i);
  });
});
