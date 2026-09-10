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
  customerTargeting: string;
  specificCustomerIds: string | null;
  shopifyDiscountId: string | null;
  discountCode: string | null;
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
let lastCreateVariables: { basicCodeDiscount: Record<string, unknown> } | null = null;
let activateShouldFail = false;

const graphqlMock = vi.fn(async (query: string, options?: { variables?: Record<string, unknown> }) => ({
  json: async () => {
    if (query.includes("DiscountCodeBasicCreate")) {
      lastCreateVariables = options?.variables as { basicCodeDiscount: Record<string, unknown> } | null;
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
    if (query.includes("DiscountCodeActivate")) {
      if (activateShouldFail) {
        return { data: { discountCodeActivate: { codeDiscountNode: null, userErrors: [{ field: null, message: "Discount no longer exists" }] } } };
      }
      return { data: { discountCodeActivate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" }, userErrors: [] } } };
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
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeCoupon> }) => {
        const coupon = coupons.find((c) => c.id === where.id);
        if (!coupon) throw new Error("Coupon not found");
        Object.assign(coupon, data);
        const issuedCount = redemptions.filter((r) => r.couponId === coupon.id && r.status === "issued").length;
        return { ...coupon, _count: { redemptions: issuedCount } };
      }),
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
    customerTargeting: "all",
    specificCustomerIds: null,
    shopifyDiscountId: null,
    discountCode: null,
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
  lastCreateVariables = null;
  activateShouldFail = false;
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

describe("activateCoupon — real Shopify discount lifecycle (Phase 5 regression coverage)", () => {
  it("activates a draft coupon with no customer at all — 'all customers' needs no customer selection", async () => {
    coupons.push(baseCoupon({ status: "draft" }));
    const result = await couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.status).toBe("active");
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(lastCreateVariables?.basicCodeDiscount.customerSelection).toEqual({ all: true });
  });

  it("stores the real Shopify discount id and code returned by Shopify, never a fabricated one", async () => {
    coupons.push(baseCoupon({ status: "draft" }));
    const result = await couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.shopifyDiscountId).toBe("gid://shopify/DiscountCodeNode/1");
    expect(result.discountCode).toBeTruthy();
  });

  it("restricts the discount to specific customers only when customerTargeting is 'specific'", async () => {
    coupons.push(
      baseCoupon({
        status: "draft",
        customerTargeting: "specific",
        specificCustomerIds: JSON.stringify(["gid://shopify/Customer/1", "gid://shopify/Customer/2"]),
      }),
    );
    await couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(lastCreateVariables?.basicCodeDiscount.customerSelection).toEqual({
      customers: { add: ["gid://shopify/Customer/1", "gid://shopify/Customer/2"] },
    });
  });

  it("reactivating a paused coupon reuses the SAME existing Shopify discount — never mints a second one", async () => {
    coupons.push(
      baseCoupon({
        status: "paused",
        shopifyDiscountId: "gid://shopify/DiscountCodeNode/existing",
        discountCode: "SUMMER-EXIST1",
      }),
    );
    const result = await couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.status).toBe("active");
    expect(result.shopifyDiscountId).toBe("gid://shopify/DiscountCodeNode/existing");
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(graphqlMock.mock.calls[0][0]).toContain("DiscountCodeActivate");
  });

  it("refuses to reactivate an ended coupon", async () => {
    coupons.push(baseCoupon({ status: "ended" }));
    await expect(couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1")).rejects.toThrow(/ended/i);
    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it("is idempotent for an already-active coupon — no duplicate Shopify call", async () => {
    coupons.push(baseCoupon({ status: "active", shopifyDiscountId: "gid://shopify/DiscountCodeNode/1", discountCode: "ALREADY-ACTIVE" }));
    const result = await couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.status).toBe("active");
    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it("on a real Shopify failure (e.g. duplicate code), leaves the coupon in draft with no fabricated discount id", async () => {
    coupons.push(baseCoupon({ status: "draft" }));
    graphqlResult = "userError";
    await expect(couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1")).rejects.toThrow(/already exists/i);
    expect(coupons[0].status).toBe("draft");
    expect(coupons[0].shopifyDiscountId).toBeNull();
  });

  it("on a real Shopify failure reactivating a paused coupon, leaves the coupon paused rather than fabricating success", async () => {
    coupons.push(baseCoupon({ status: "paused", shopifyDiscountId: "gid://shopify/DiscountCodeNode/existing" }));
    activateShouldFail = true;
    await expect(couponsService.activateCoupon("store_1", "shop.myshopify.com", "coupon_1")).rejects.toThrow(/no longer exists/i);
    expect(coupons[0].status).toBe("paused");
  });
});

describe("pauseCoupon / endCoupon — real Shopify deactivation (Phase 5 regression coverage)", () => {
  it("pauseCoupon deactivates the real Shopify discount when one exists", async () => {
    coupons.push(baseCoupon({ status: "active", shopifyDiscountId: "gid://shopify/DiscountCodeNode/1" }));
    const result = await couponsService.pauseCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.status).toBe("paused");
    expect(graphqlMock.mock.calls[0][0]).toContain("DiscountCodeDeactivate");
  });

  it("pauseCoupon on a never-activated draft coupon just flips local status — nothing real to deactivate", async () => {
    coupons.push(baseCoupon({ status: "draft" }));
    const result = await couponsService.pauseCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.status).toBe("paused");
    expect(graphqlMock).not.toHaveBeenCalled();
  });

  it("endCoupon deactivates the real Shopify discount and is a one-directional terminal state", async () => {
    coupons.push(baseCoupon({ status: "active", shopifyDiscountId: "gid://shopify/DiscountCodeNode/1" }));
    const result = await couponsService.endCoupon("store_1", "shop.myshopify.com", "coupon_1");
    expect(result.status).toBe("ended");
    expect(graphqlMock.mock.calls[0][0]).toContain("DiscountCodeDeactivate");
  });
});
