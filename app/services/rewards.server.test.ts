// Exercises rewards.server.ts's real eligibility logic and the duplicate-prevention/
// persistence flow around it — no real database, no real Shopify API call (unauthenticated.admin
// and the email provider are both mocked).
import { readFileSync } from "node:fs";
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
  /** Prisma maintains this via @updatedAt; the pending claim uses it as its lease timestamp. */
  updatedAt: Date;
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

/** Models a real Postgres round trip. The reward flow's correctness depends on what can
 *  happen BETWEEN two queries, and a mock that resolves in microtasks keeps concurrent callers
 *  in lockstep, hiding exactly the window under test. Default 0 so existing tests are unaffected. */
let dbLatencyMs = 0;
const dbRoundTrip = async () => {
  if (dbLatencyMs > 0) await new Promise((resolve) => setTimeout(resolve, dbLatencyMs));
};

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

vi.mock("./permissions", () => ({
  getStorePermissions: vi.fn(async () => ({ canUseBrandedEmailSender: false })),
}));

vi.mock("./notifications/provider.server", () => ({
  getEmailProvider: () => ({ name: "fake", sendEmail: sendEmailMock }),
}));

vi.mock("../db.server", () => ({
  default: {
    store: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        await dbRoundTrip();
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
      // Backs the reward email's sender identity and shared Email Branding lookup. Reads
      // the same fake store list as everything else here, so the email resolves against the
      // real fixture rather than a second invented store.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const store = stores.find((s) => s.id === where.id);
        if (!store) return null;
        return {
          name: store.name ?? "Verve Outdoor",
          emailSenderName: null,
          emailLogoUrl: null,
          emailLogoDarkUrl: null,
        };
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
          updatedAt: new Date(),
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
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { reviewId: string; status?: string; updatedAt?: { lt: Date } };
          data: Partial<FakeReward>;
        }) => {
          let count = 0;
          for (const reward of rewards) {
            if (reward.reviewId !== where.reviewId) continue;
            if (where.status !== undefined && reward.status !== where.status) continue;
            if (where.updatedAt && !(reward.updatedAt.getTime() < where.updatedAt.lt.getTime())) continue;
            Object.assign(reward, data, { updatedAt: new Date() });
            count += 1;
          }
          return { count };
        },
      ),
        update: vi.fn(async ({ where, data }: { where: { reviewId: string }; data: Partial<FakeReward> }) => {
        const reward = rewards.find((r) => r.reviewId === where.reviewId);
        if (!reward) throw new Error("Record to update not found");
        Object.assign(reward, data, { updatedAt: new Date() });
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

  // CONTRACT CHANGE (2026-11-06). This used to assert the opposite: that a 3-star review was
  // ineligible because a merchant had set a minimum rating of 4.
  //
  // Rewarding only highly-rated reviews is paying for positive reviews. It is prohibited by
  // the FTC's rule on consumer reviews (16 CFR Part 465) and by Shopify's App Store review
  // integrity requirements, and the liability sits with the APP. The benchmark reached the
  // same conclusion: Judge.me removed rating-based coupon rules from its own product to
  // comply with Shopify's policy.
  //
  // So the condition does not exist any more, and this is the test that keeps it from coming
  // back — every rating must reach the same verdict on otherwise-identical input.
  it.each([1, 2, 3, 4, 5])("is eligible at %i stars — rating must never affect a reward", (rating) => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating, verifiedPurchase: true, hasPhoto: false, hasVideo: false },
      baseSettings(),
    );
    expect(result.eligible).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("gives a one-star review exactly the same verdict as a five-star one", () => {
    const settings = baseSettings();
    const base = { status: "APPROVED" as const, verifiedPurchase: true, hasPhoto: false, hasVideo: false };

    expect(evaluateEligibility({ ...base, rating: 1 }, settings)).toEqual(
      evaluateEligibility({ ...base, rating: 5 }, settings),
    );
  });

  // The form-vs-sentiment distinction the FTC rule draws: a condition about what the review
  // CONTAINS is fine, a condition about what it SAYS is not.
  it("still refuses a one-star review that fails a condition about the review's form", () => {
    const result = evaluateEligibility(
      { status: "APPROVED", rating: 1, verifiedPurchase: true, hasPhoto: false, hasVideo: false },
      { ...baseSettings(), requirePhoto: true },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/photo/i);
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
      requireVerified: false,
      requirePhoto: true,
      requireVideo: true,
    });

    const settings = await getRewardSettings("store_1");
    expect(settings).toEqual({
      enabled: true,
      valueType: "fixed_amount",
      value: 5,
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
    dbLatencyMs = 0;
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
    // A condition about the review's FORM — this store requires a verified purchase, and this
    // review is not one. (This used to use a low rating, which is no longer a condition at all.)
    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_2", verifiedPurchase: false });

    expect(graphqlMock).not.toHaveBeenCalled();
    const reward = rewards.find((r) => r.reviewId === "review_2");
    expect(reward?.status).toBe("ineligible");
  });

  // The end-to-end counterpart to the eligibility tests above: a two-star review must reach
  // Shopify and get a real discount, exactly like a five-star one.
  it("issues a real discount for a two-star review", async () => {
    await evaluateAndIssueReward({ ...eligibleReview, reviewId: "review_low", rating: 2 });

    expect(graphqlMock).toHaveBeenCalledTimes(1);
    const reward = rewards.find((r) => r.reviewId === "review_low");
    expect(reward?.status).toBe("issued");
    expect(reward?.discountCode).toMatch(/^THANKS-/);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PROOF TESTS, written against the current implementation before any fix. Each pins a real
// defect in the reward flow. A reward has an EXTERNAL side effect — a live Shopify discount
// code — so "the database row is unique" is not the same as "we only created one discount".
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("reward issuing — duplicate prevention and delivery state", () => {
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
    dbLatencyMs = 0;
    graphqlMock.mockClear();
    sendEmailMock.mockClear();
  });

  const eligible = {
    reviewId: "review_race",
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

  it("PROOF A: two concurrent approvals must not create two real Shopify discounts", async () => {
    // setReviewStatus fires `void issueRewardIfEligible(...)` on every transition to APPROVED,
    // so a double-click in the admin, two moderators, or an approve/reject/approve sequence
    // runs this twice concurrently. The reviewId unique constraint protects the Reward ROW —
    // it does not protect the Shopify mutation, which happens first.
    dbLatencyMs = 5; // a real query round trip, which is what opens the window
    await Promise.all([evaluateAndIssueReward(eligible), evaluateAndIssueReward(eligible)]);

    // Exactly one live discount code may exist for one review.
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(rewards.filter((r) => r.reviewId === "review_race")).toHaveLength(1);
  });

  it("PROOF B: a reward whose email fails is not left looking delivered", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend 500"));

    await evaluateAndIssueReward({ ...eligible, reviewId: "review_emailfail" });

    const reward = rewards.find((r) => r.reviewId === "review_emailfail");
    // The discount is real and must be kept, and "issued" is the truthful status for it — the
    // reward WAS issued. What was missing is any record that the customer never received the
    // code. Recording it in `reason` needs no schema change and no change to getRewardStats,
    // so the merchant can see the delivery failure without the discount being misreported.
    expect(reward?.discountCode).toBeTruthy();
    expect(reward?.status).toBe("issued");
    expect(reward?.reason ?? "").toMatch(/could not be (sent|delivered)/i);
  });

  it("PROOF C: discount codes are unguessable and always full length", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      graphqlMock.mockClear();
      await evaluateAndIssueReward({ ...eligible, reviewId: `review_code_${i}` });
      const code = rewards.find((r) => r.reviewId === `review_code_${i}`)?.discountCode;
      expect(code).toBeTruthy();
      // Math.random().toString(36).slice(2, 8) can yield FEWER than 6 characters when the
      // random value is short (e.g. 0.5 -> "0.i"), producing a trivially short code.
      expect(code).toMatch(/^THANKS-[0-9A-Z]{8}$/);
      codes.add(code!);
    }
    expect(codes.size).toBe(200);
  });
});

describe("abandoned pending claims", () => {
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
    dbLatencyMs = 0;
    graphqlMock.mockClear();
    sendEmailMock.mockClear();
  });

  const eligible = {
    reviewId: "review_pending",
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

  const pendingRow = (updatedAt: Date): FakeReward => ({
    id: "reward_stuck",
    storeId: "store_1",
    reviewId: "review_pending",
    status: "pending",
    reason: null,
    valueType: "percentage",
    value: 10,
    discountCode: null,
    shopifyDiscountId: null,
    updatedAt,
  });

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

  it("retries a claim abandoned by a crashed process, and issues exactly one discount", async () => {
    rewards = [pendingRow(minutesAgo(30))];

    await evaluateAndIssueReward(eligible);

    expect(graphqlMock).toHaveBeenCalledTimes(1);
    const reward = rewards.find((r) => r.reviewId === "review_pending");
    expect(reward?.status).toBe("issued");
    expect(reward?.discountCode).toMatch(/^THANKS-[0-9A-Z]{8}$/);
    expect(rewards.filter((r) => r.reviewId === "review_pending")).toHaveLength(1);
  });

  it("never steals a claim that is still in flight", async () => {
    rewards = [pendingRow(minutesAgo(2))];

    await evaluateAndIssueReward(eligible);

    // The original attempt still owns it — touching it here would be the duplicate-discount
    // bug reintroduced through the recovery path.
    expect(graphqlMock).not.toHaveBeenCalled();
    expect(rewards.find((r) => r.reviewId === "review_pending")?.status).toBe("pending");
  });

  it("two recoveries racing the same abandoned claim still issue exactly one discount", async () => {
    rewards = [pendingRow(minutesAgo(30))];
    dbLatencyMs = 5;

    await Promise.all([evaluateAndIssueReward(eligible), evaluateAndIssueReward(eligible)]);

    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(rewards.filter((r) => r.reviewId === "review_pending")).toHaveLength(1);
  });

  it("leaves terminal rewards alone no matter how old they are", async () => {
    for (const status of ["issued", "failed", "ineligible"]) {
      rewards = [{ ...pendingRow(minutesAgo(60 * 24 * 90)), status }];
      graphqlMock.mockClear();

      await evaluateAndIssueReward(eligible);

      expect(graphqlMock).not.toHaveBeenCalled();
      expect(rewards.find((r) => r.reviewId === "review_pending")?.status).toBe(status);
    }
  });
});

describe("getRewardStats", () => {
  it("counts rewards by status for the given store only", async () => {
    stores = [];
    rewards = [
      { id: "r1", storeId: "store_1", reviewId: "rev1", status: "issued", reason: null, valueType: "percentage", value: 10, discountCode: "A", shopifyDiscountId: "g1", updatedAt: new Date() },
      { id: "r2", storeId: "store_1", reviewId: "rev2", status: "issued", reason: null, valueType: "percentage", value: 10, discountCode: "B", shopifyDiscountId: "g2", updatedAt: new Date() },
      { id: "r3", storeId: "store_1", reviewId: "rev3", status: "ineligible", reason: "low rating", valueType: "percentage", value: 10, discountCode: null, shopifyDiscountId: null, updatedAt: new Date() },
      { id: "r4", storeId: "store_2", reviewId: "rev4", status: "issued", reason: null, valueType: "percentage", value: 10, discountCode: "C", shopifyDiscountId: "g3", updatedAt: new Date() },
    ];

    const stats = await getRewardStats("store_1");
    expect(stats).toEqual({ issued: 2, pending: 0, failed: 0, ineligible: 1 });
  });
});

// A structural guard, not a behavioural one. The behavioural tests above prove every rating
// reaches the same verdict today; this proves the condition cannot be reintroduced without
// someone deliberately deleting an assertion that explains why it must not be.
describe("rating can never gate a reward", () => {
  const SOURCE = readFileSync("app/services/rewards.server.ts", "utf8");

  it("evaluateEligibility does not read the rating at all", () => {
    const start = SOURCE.indexOf("export function evaluateEligibility(");
    const body = SOURCE.slice(start, SOURCE.indexOf("\n}", start));
    // The parameter type may mention rating; the function body must never branch on it.
    expect(body).not.toMatch(/review\.rating/);
  });

  it("no minimum-rating setting survives in the code itself", () => {
    // Compensation conditioned on review sentiment is prohibited by the FTC's rule on
    // consumer reviews (16 CFR Part 465) and by Shopify's App Store review-integrity
    // requirements, and the liability lands on the app rather than the merchant.
    //
    // Comments are stripped first: this file's own header explains at length why minRating
    // was removed, and that explanation is the opposite of a breach.
    const code = SOURCE.split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
      })
      .join("\n");

    expect(code).not.toMatch(/minRating/);
  });

  it("the retired column still carries its do-not-reintroduce warning", () => {
    // Kept rather than dropped (removing it needs a migration), so the warning is the only
    // thing standing between it and someone wiring it back up.
    const SCHEMA = readFileSync("prisma/schema.prisma", "utf8");
    if (!SCHEMA.includes("rewardMinRating")) return;

    const at = SCHEMA.indexOf("rewardMinRating");
    const preamble = SCHEMA.slice(Math.max(0, at - 1200), at);
    expect(preamble).toMatch(/16 CFR Part 465/);
    expect(preamble).toMatch(/review-integrity/);
  });
});
