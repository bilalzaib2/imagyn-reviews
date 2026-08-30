// Exercises rewards.server.ts's real eligibility logic and the duplicate-prevention/
// persistence flow around it — no real database, no real Shopify API call (unauthenticated.admin
// and the email provider are both mocked).
import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeReward {
  id: string;
  storeId: string;
  reviewId: string;
  status: string;
  reason: string | null;
  valueType: string;
  value: number;
  discountCode: string | null;
  shopifyDiscountId: string | null;
}

interface FakeStore {
  id: string;
  domain: string;
  slug: string;
  name: string;
  rewardsEnabled: boolean;
  rewardValueType: string;
  rewardValue: number;
  rewardMinRating: number;
  rewardRequireVerified: boolean;
  rewardRequirePhoto: boolean;
  rewardRequireVideo: boolean;
}

let rewards: FakeReward[];
let stores: FakeStore[];
let nextId: number;

interface FakeGraphqlResponse {
  json: () => Promise<{
    data: {
      discountCodeBasicCreate: {
        codeDiscountNode: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    };
  }>;
}

const graphqlMock = vi.fn(
  async (): Promise<FakeGraphqlResponse> => ({
    json: async () => ({
      data: {
        discountCodeBasicCreate: {
          codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/1" },
          userErrors: [],
        },
      },
    }),
  }),
);

const sendEmailMock = vi.fn(async () => ({ id: "fake-message-id" }));

vi.mock("../shopify.server", () => ({
  unauthenticated: {
    admin: vi.fn(async () => ({ admin: { graphql: graphqlMock } })),
  },
}));

vi.mock("./notifications/provider.server", () => ({
  getEmailProvider: () => ({ name: "fake", sendEmail: sendEmailMock }),
}));

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const store = stores.find((s) => s.id === where.id);
        if (!store) throw new Error("Store not found");
        return store;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeStore> }) => {
        const store = stores.find((s) => s.id === where.id);
        if (!store) throw new Error("Store not found");
        Object.assign(store, data);
        return store;
      }),
    },
    // Backs emailTemplateService.getActiveContent (called when sending the reward email) —
    // null falls back to getDefaultEmailTemplateContent, exactly like an unconfigured store
    // in production. Same convention as review-request.server.test.ts's identical mock.
    emailTemplate: {
      findFirst: vi.fn(async () => null),
    },
    reward: {
      findUnique: vi.fn(async ({ where }: { where: { reviewId: string } }) => {
        return rewards.find((r) => r.reviewId === where.reviewId) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeReward> & { storeId: string; reviewId: string } }) => {
        if (rewards.some((r) => r.reviewId === data.reviewId)) {
          throw new Error("Unique constraint violation on reviewId");
        }
        const reward: FakeReward = {
          id: `reward_${nextId++}`,
          status: "pending",
          reason: null,
          valueType: "percentage",
          value: 10,
          discountCode: null,
          shopifyDiscountId: null,
          ...data,
        };
        rewards.push(reward);
        return reward;
      }),
      groupBy: vi.fn(async ({ where }: { where: { storeId: string } }) => {
        const matching = rewards.filter((r) => r.storeId === where.storeId);
        const counts = new Map<string, number>();
        for (const r of matching) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
        return Array.from(counts.entries()).map(([status, count]) => ({ status, _count: { status: count } }));
      }),
    },
  },
}));

const {
  evaluateEligibility,
  evaluateAndIssueReward,
  getRewardSettings,
  updateRewardSettings,
  getRewardStats,
} = await import("./rewards.server");

function baseSettings() {
  return {
    enabled: true,
    valueType: "percentage" as const,
    value: 10,
    minRating: 4,
    requireVerified: true,
    requirePhoto: false,
    requireVideo: false,
  };
}

describe("evaluateEligibility", () => {
  it("is ineligible when rewards are disabled", () => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating: 5, verifiedPurchase: true, hasPhoto: false, hasVideo: false },
      { ...baseSettings(), enabled: false },
    );
    expect(result.eligible).toBe(false);
  });

  it("is ineligible when the review isn't approved", () => {
    const result = evaluateEligibility(
      { status: "PENDING", rating: 5, verifiedPurchase: true, hasPhoto: false, hasVideo: false },
      baseSettings(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not approved/i);
  });

  it("is ineligible when the rating is below the configured minimum", () => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating: 3, verifiedPurchase: true, hasPhoto: false, hasVideo: false },
      baseSettings(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/below the required minimum/i);
  });

  it("is ineligible when verified purchase is required but missing", () => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating: 5, verifiedPurchase: false, hasPhoto: false, hasVideo: false },
      baseSettings(),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/verified purchase/i);
  });

  it("is ineligible when a photo is required but missing", () => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating: 5, verifiedPurchase: true, hasPhoto: false, hasVideo: false },
      { ...baseSettings(), requirePhoto: true },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/photo/i);
  });

  it("is eligible when every configured condition is met", () => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating: 5, verifiedPurchase: true, hasPhoto: true, hasVideo: false },
      { ...baseSettings(), requirePhoto: true },
    );
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
  });
});

describe("getRewardSettings / updateRewardSettings", () => {
  beforeEach(() => {
    stores = [
      {
        id: "store_1",
        domain: "store-1.myshopify.com",
        slug: "store-1",
        name: "Store One",
        rewardsEnabled: false,
        rewardValueType: "percentage",
        rewardValue: 10,
        rewardMinRating: 4,
        rewardRequireVerified: true,
        rewardRequirePhoto: false,
        rewardRequireVideo: false,
      },
    ];
    rewards = [];
    nextId = 1;
  });

  it("round-trips settings through update then read", async () => {
    await updateRewardSettings("store_1", {
      enabled: true,
      valueType: "fixed_amount",
      value: 5,
      minRating: 5,
      requireVerified: false,
      requirePhoto: true,
      requireVideo: true,
    });

    const settings = await getRewardSettings("store_1");
    expect(settings).toEqual({
      enabled: true,
      valueType: "fixed_amount",
      value: 5,
      minRating: 5,
      requireVerified: false,
      requirePhoto: true,
      requireVideo: true,
    });
  });
});

describe("evaluateAndIssueReward", () => {
  beforeEach(() => {
    stores = [
      {
        id: "store_1",
        domain: "store-1.myshopify.com",
        slug: "store-1",
        name: "Store One",
        rewardsEnabled: true,
        rewardValueType: "percentage",
        rewardValue: 10,
        rewardMinRating: 4,
        rewardRequireVerified: true,
        rewardRequirePhoto: false,
        rewardRequireVideo: false,
      },
    ];
    rewards = [];
    nextId = 1;
    graphqlMock.mockClear();
    sendEmailMock.mockClear();
  });

  const eligibleReview = {
    reviewId: "review_1",
    storeId: "store_1",
    storeDomain: "store-1.myshopify.com",
    storeName: "Store One",
    customerName: "Jordan Avery",
    customerEmail: "jordan@example.com",
    productName: "Ceramic Mug",
    status: "APPROVED",
    rating: 5,
    verifiedPurchase: true,
    hasPhoto: false,
    hasVideo: false,
  };

  it("issues a real discount via the Shopify Admin GraphQL client and persists an 'issued' Reward row", async () => {
    await evaluateAndIssueReward(eligibleReview);

    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const reward = rewards.find((r) => r.reviewId === "review_1");
    expect(reward?.status).toBe("issued");
    expect(reward?.discountCode).toMatch(/^THANKS-/);
    expect(reward?.shopifyDiscountId).toBe("gid://shopify/DiscountCodeNode/1");
  });

  it("never calls Shopify and records 'ineligible' when the review doesn't meet the conditions", async () => {
    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_2", rating: 2 });

    expect(graphqlMock).not.toHaveBeenCalled();
    const reward = rewards.find((r) => r.reviewId === "review_2");
    expect(reward?.status).toBe("ineligible");
  });

  it("never issues a second reward for the same review — duplicate prevention", async () => {
    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_3" });
    expect(graphqlMock).toHaveBeenCalledTimes(1);

    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_3" });
    // Still exactly one call — the second evaluation short-circuited on the existing Reward row.
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(rewards.filter((r) => r.reviewId === "review_3")).toHaveLength(1);
  });

  it("records 'failed' (never fakes 'issued') when Shopify's mutation returns a userError", async () => {
    graphqlMock.mockResolvedValueOnce({
      json: async () => ({
        data: {
          discountCodeBasicCreate: {
            codeDiscountNode: null,
            userErrors: [{ field: ["code"], message: "Code already exists" }],
          },
        },
      }),
    });

    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_4" });

    const reward = rewards.find((r) => r.reviewId === "review_4");
    expect(reward?.status).toBe("failed");
    expect(reward?.discountCode).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("records 'failed' instead of issuing when there's no customer email to send the reward to", async () => {
    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_5", customerEmail: null });

    expect(graphqlMock).not.toHaveBeenCalled();
    const reward = rewards.find((r) => r.reviewId === "review_5");
    expect(reward?.status).toBe("failed");
  });
});

describe("getRewardStats", () => {
  it("counts rewards by status for the given store only", async () => {
    stores = [];
    rewards = [
      { id: "r1", storeId: "store_1", reviewId: "rev1", status: "issued", reason: null, valueType: "percentage", value: 10, discountCode: "A", shopifyDiscountId: "g1" },
      { id: "r2", storeId: "store_1", reviewId: "rev2", status: "issued", reason: null, valueType: "percentage", value: 10, discountCode: "B", shopifyDiscountId: "g2" },
      { id: "r3", storeId: "store_1", reviewId: "rev3", status: "ineligible", reason: "low rating", valueType: "percentage", value: 10, discountCode: null, shopifyDiscountId: null },
      { id: "r4", storeId: "store_2", reviewId: "rev4", status: "issued", reason: null, valueType: "percentage", value: 10, discountCode: "C", shopifyDiscountId: "g3" },
    ];

    const stats = await getRewardStats("store_1");
    expect(stats).toEqual({ issued: 2, pending: 0, failed: 0, ineligible: 1 });
  });
});
