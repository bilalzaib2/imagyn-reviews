// Regression tests for IMAGYN Trust Certification — the single highest-stakes file in this
// feature, since a wrong answer here is a fabricated (or wrongly withheld) certification
// claim shown to real shoppers. Pure calculator functions are tested directly with no
// mocking; only the persistence-layer functions (recalculateTrustCertification,
// getTrustCertification, setTrustCertificationPaused) mock db.server, matching this
// codebase's existing aiSummary.server.test.ts convention.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewStatus } from "./review.shared";
import {
  MIN_VERIFIED_REVIEWS,
  TRUST_CERTIFICATION_STALE_MS,
  calculateReviewPracticesPillar,
  calculatePaymentMethodsPillar,
  calculatePolicyPillar,
  calculateStoreHistoryPillar,
  deriveOverallStatus,
  isTrustCertificationStale,
  type TrustPillars,
} from "./trustCertification.server";

function verifiedReview(status: string, rating = 5) {
  return { status, rating };
}

describe("calculateReviewPracticesPillar", () => {
  it("is pending with zero verified reviews", () => {
    const result = calculateReviewPracticesPillar([]);
    expect(result.status).toBe("pending");
    expect(result.percent).toBeNull();
    expect(result.verifiedReviewCount).toBe(0);
  });

  it("is pending with fewer than the minimum verified reviews, even at 100% published", () => {
    const reviews = Array.from({ length: MIN_VERIFIED_REVIEWS - 1 }, () => verifiedReview(ReviewStatus.APPROVED));
    const result = calculateReviewPracticesPillar(reviews);
    expect(result.status).toBe("pending");
    expect(result.percent).toBe(100);
    expect(result.reason).toContain(`${MIN_VERIFIED_REVIEWS}`);
  });

  it("is met at exactly the minimum verified reviews with 100% published", () => {
    const reviews = Array.from({ length: MIN_VERIFIED_REVIEWS }, () => verifiedReview(ReviewStatus.APPROVED));
    const result = calculateReviewPracticesPillar(reviews);
    expect(result.status).toBe("met");
    expect(result.percent).toBe(100);
    expect(result.verifiedReviewCount).toBe(MIN_VERIFIED_REVIEWS);
  });

  it("is met at exactly 95% published", () => {
    // 19 of 20 published = exactly 95%.
    const reviews = [
      ...Array.from({ length: 19 }, () => verifiedReview(ReviewStatus.APPROVED)),
      verifiedReview(ReviewStatus.PENDING),
    ];
    const result = calculateReviewPracticesPillar(reviews);
    expect(result.percent).toBe(95);
    expect(result.status).toBe("met");
  });

  it("is not_met just below the 95% threshold", () => {
    // 18 of 20 published = 90%.
    const reviews = [
      ...Array.from({ length: 18 }, () => verifiedReview(ReviewStatus.APPROVED)),
      verifiedReview(ReviewStatus.PENDING),
      verifiedReview(ReviewStatus.REJECTED),
    ];
    const result = calculateReviewPracticesPillar(reviews);
    expect(result.percent).toBe(90);
    expect(result.status).toBe("not_met");
    expect(result.reason).toContain("90%");
  });

  it("never counts unverified reviews toward the calculation (caller-enforced, verified here by construction)", () => {
    // The function only ever receives pre-filtered verified reviews — this test documents
    // that contract: passing an all-published set of exactly the minimum size is 100%/met,
    // proving nothing about an unverified population leaks in via a shared count.
    const reviews = Array.from({ length: MIN_VERIFIED_REVIEWS }, () => verifiedReview(ReviewStatus.APPROVED));
    const result = calculateReviewPracticesPillar(reviews);
    expect(result.verifiedReviewCount).toBe(MIN_VERIFIED_REVIEWS);
  });

  it("computes a real average rating from the verified population", () => {
    const reviews = [verifiedReview(ReviewStatus.APPROVED, 5), verifiedReview(ReviewStatus.APPROVED, 3)];
    const result = calculateReviewPracticesPillar(reviews);
    expect(result.verifiedAverageRating).toBe(4);
  });
});

describe("calculatePaymentMethodsPillar", () => {
  it("is pending with zero orders", () => {
    const result = calculatePaymentMethodsPillar([]);
    expect(result.status).toBe("pending");
  });

  it("is met when a real gateway is present", () => {
    const result = calculatePaymentMethodsPillar([["shopify_payments"], ["manual"]]);
    expect(result.status).toBe("met");
  });

  it("is met for a real qualifying gateway alone", () => {
    const result = calculatePaymentMethodsPillar([["paypal"]]);
    expect(result.status).toBe("met");
  });

  it("does not treat Shopify's test-mode gateway as a real qualifying method", () => {
    const result = calculatePaymentMethodsPillar([["bogus"]]);
    expect(result.status).toBe("not_met");
  });

  // IMAGYN's own Trust Certification criterion (not Shopify's Built for Shopify/App Store
  // requirements, which this pillar never touches): COD is a fully legitimate, Shopify-
  // supported payment method for IMAGYN's heavily-COD target market, so it is an ACCEPTED
  // payment method here, never a disqualifying one — the pillar only asks "did a customer
  // ever complete a real purchase," never "which specific gateway did they use." See the
  // 2026-09-10 correction to this pillar's logic for the full rationale.
  describe("COD / payment-availability scenarios (explicit regression coverage)", () => {
    it("1. COD-only store: Secure Payment Methods pillar is MET", () => {
      const result = calculatePaymentMethodsPillar([["cod"], ["cash_on_delivery"], ["manual"]]);
      expect(result.status).toBe("met");
    });

    it("3. COD-heavy recent orders (COD vastly outnumbering the one card order) do not cause a failure", () => {
      const result = calculatePaymentMethodsPillar([
        ["cod"],
        ["cod"],
        ["cod"],
        ["cod"],
        ["cash_on_delivery"],
        ["shopify_payments"],
      ]);
      expect(result.status).toBe("met");
    });

    it("4. Shopify Payments / card gateway alone — MET", () => {
      const result = calculatePaymentMethodsPillar([["shopify_payments"], ["shopify_payments"]]);
      expect(result.status).toBe("met");
    });

    it("5. Mixed COD + online payment gateway — MET", () => {
      const result = calculatePaymentMethodsPillar([
        ["cod"],
        ["shopify_payments"],
        ["cash_on_delivery"],
        ["manual"],
        ["shopify_payments"],
      ]);
      expect(result.status).toBe("met");
    });

    it("6. No legitimate checkout/payment configuration (only Shopify's test-mode gateway) — NOT MET", () => {
      const result = calculatePaymentMethodsPillar([["bogus"], ["free"]]);
      expect(result.status).toBe("not_met");
    });

    it("10. Never fabricates evidence: zero orders is pending, never a false MET or false NOT MET", () => {
      const result = calculatePaymentMethodsPillar([]);
      expect(result.status).toBe("pending");
      expect(result.status).not.toBe("not_met");
    });
  });
});

describe("calculatePolicyPillar", () => {
  it("is needs_permission when policies could not be read at all", () => {
    const result = calculatePolicyPillar(null);
    expect(result.status).toBe("needs_permission");
  });

  it("is not_met when the refund policy is missing entirely", () => {
    const result = calculatePolicyPillar({
      refundPolicyBody: null,
      shippingPolicyBody: "We ship worldwide. Delivery takes 5-7 business days.",
    });
    expect(result.status).toBe("not_met");
    expect(result.detail).toContain("Refund policy not published");
  });

  it("is not_met when the shipping policy is missing entirely", () => {
    const result = calculatePolicyPillar({
      refundPolicyBody: "Returns accepted within 30 days for a full refund.",
      shippingPolicyBody: null,
    });
    expect(result.status).toBe("not_met");
    expect(result.detail).toContain("Shipping policy not published");
  });

  it("is not_met when a policy exists but states no timeframe (not a simplistic exists-check)", () => {
    const result = calculatePolicyPillar({
      refundPolicyBody: "We accept returns and offer refunds for damaged or defective items upon request.",
      shippingPolicyBody: "We ship to most countries worldwide using trusted couriers and reliable carriers everywhere.",
    });
    expect(result.status).toBe("not_met");
    expect(result.detail).toContain("timeframe");
  });

  it("is not_met when a policy is too short to be real", () => {
    const result = calculatePolicyPillar({
      refundPolicyBody: "No refunds.",
      shippingPolicyBody: "We ship worldwide within 5-7 business days of purchase.",
    });
    expect(result.status).toBe("not_met");
  });

  it("is met when both policies state real terms and a timeframe", () => {
    const result = calculatePolicyPillar({
      refundPolicyBody:
        "You may request a refund or exchange within 30 days of delivery if the item is unused and in its original packaging.",
      shippingPolicyBody: "Orders ship within 2 business days and typically arrive within 5-7 business days.",
    });
    expect(result.status).toBe("met");
  });
});

describe("calculateStoreHistoryPillar", () => {
  const now = new Date("2026-09-09T00:00:00Z");

  it("is not_met for a store younger than 3 months", () => {
    const createdAt = new Date("2026-08-01T00:00:00Z"); // ~39 days old
    const result = calculateStoreHistoryPillar(createdAt, now);
    expect(result.status).toBe("not_met");
  });

  it("is met for a store older than 3 months", () => {
    const createdAt = new Date("2025-01-01T00:00:00Z");
    const result = calculateStoreHistoryPillar(createdAt, now);
    expect(result.status).toBe("met");
  });

  it("is met at exactly the 90-day boundary", () => {
    const createdAt = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const result = calculateStoreHistoryPillar(createdAt, now);
    expect(result.status).toBe("met");
  });

  it("is not_met one day short of the 90-day boundary", () => {
    const createdAt = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
    const result = calculateStoreHistoryPillar(createdAt, now);
    expect(result.status).toBe("not_met");
  });
});

describe("deriveOverallStatus", () => {
  const met = { status: "met" as const };
  const notMet = { status: "not_met" as const };
  const pending = { status: "pending" as const };
  const needsPermission = { status: "needs_permission" as const };

  function pillars(overrides: Partial<Record<keyof TrustPillars, { status: string }>>): TrustPillars {
    const base = {
      reviewPractices: { status: "met", percent: 100, reason: null, verifiedReviewCount: 10, verifiedAverageRating: 4.5 },
      paymentMethods: { status: "met", detail: null },
      policy: { status: "met", detail: null },
      storeHistory: { status: "met", detail: null },
    };
    return { ...base, ...overrides } as unknown as TrustPillars;
  }

  it("is certified when all four pillars are met", () => {
    expect(deriveOverallStatus(pillars({}), false, false)).toBe("certified");
  });

  it("is not_certified when one pillar fails and the store was never certified before", () => {
    expect(deriveOverallStatus(pillars({ paymentMethods: notMet }), false, false)).toBe("not_certified");
  });

  it("is at_risk when one pillar fails but the store WAS certified before", () => {
    expect(deriveOverallStatus(pillars({ paymentMethods: notMet }), false, true)).toBe("at_risk");
  });

  it("is needs_permission when a pillar needs permission and none has failed", () => {
    expect(deriveOverallStatus(pillars({ policy: needsPermission }), false, false)).toBe("needs_permission");
  });

  it("is pending when a pillar is pending and none has failed or needs permission", () => {
    expect(deriveOverallStatus(pillars({ reviewPractices: pending }), false, false)).toBe("pending");
  });

  it("prioritizes a real failure over an unresolved pillar elsewhere", () => {
    expect(deriveOverallStatus(pillars({ paymentMethods: notMet, policy: needsPermission }), false, false)).toBe(
      "not_certified",
    );
  });

  it("is paused whenever paused is true, regardless of pillar states", () => {
    expect(deriveOverallStatus(pillars({}), true, false)).toBe("paused");
    expect(deriveOverallStatus(pillars({ paymentMethods: notMet }), true, true)).toBe("paused");
  });

  it("never reports a pending/needs_permission pillar as certified", () => {
    expect(deriveOverallStatus(pillars({ storeHistory: pending }), false, false)).not.toBe("certified");
    expect(deriveOverallStatus(pillars({ storeHistory: needsPermission }), false, false)).not.toBe("certified");
    expect(met.status).toBe("met"); // sanity: fixture itself is well-formed
  });

  // 2026-09-10 correction: explicit end-to-end coverage that a COD-only store, once every
  // other IMAGYN pillar genuinely passes, reaches full CERTIFIED status — COD alone must
  // never be the thing standing between a merchant and certification.
  it("2. COD-only store + all other pillars met — CERTIFIED", () => {
    const codPaymentPillar = calculatePaymentMethodsPillar([["cod"], ["cash_on_delivery"], ["manual"]]);
    expect(deriveOverallStatus(pillars({ paymentMethods: codPaymentPillar }), false, false)).toBe("certified");
  });

  // 8. The Shipping & Refund Policy pillar stays fully independent of the payment pillar —
  // a COD store with a genuinely missing/incomplete shipping policy must NOT be certified
  // just because payment is now met.
  it("8. Shipping policy can independently remain NOT MET even when payment is MET (COD store)", () => {
    const codPaymentPillar = calculatePaymentMethodsPillar([["cod"]]);
    const result = deriveOverallStatus(pillars({ paymentMethods: codPaymentPillar, policy: notMet }), false, false);
    expect(result).toBe("not_certified");
  });
});

describe("isTrustCertificationStale", () => {
  it("is not stale immediately after a check", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    expect(isTrustCertificationStale(now, now)).toBe(false);
  });

  it("is not stale just under the threshold", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    const lastCheckedAt = new Date(now.getTime() - TRUST_CERTIFICATION_STALE_MS + 1000);
    expect(isTrustCertificationStale(lastCheckedAt, now)).toBe(false);
  });

  it("is stale at exactly the threshold", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    const lastCheckedAt = new Date(now.getTime() - TRUST_CERTIFICATION_STALE_MS);
    expect(isTrustCertificationStale(lastCheckedAt, now)).toBe(true);
  });

  it("is stale well past the threshold", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    const lastCheckedAt = new Date("2026-09-01T00:00:00Z");
    expect(isTrustCertificationStale(lastCheckedAt, now)).toBe(true);
  });
});

// --- Persistence layer: recalculateTrustCertification / getTrustCertification / setTrustCertificationPaused ---

interface FakeRow {
  storeId: string;
  status: string;
  reviewPracticesStatus: string;
  reviewPracticesPercent: number | null;
  reviewPracticesReason: string | null;
  paymentMethodsStatus: string;
  paymentMethodsDetail: string | null;
  policyStatus: string;
  policyDetail: string | null;
  storeHistoryStatus: string;
  storeHistoryDetail: string | null;
  verifiedReviewCount: number;
  verifiedAverageRating: number;
  paused: boolean;
  everCertified: boolean;
  certifiedAt: Date | null;
  lastCheckedAt: Date;
}

let rows: Map<string, FakeRow>;
let verifiedReviewsFixture: Array<{ status: string; rating: number }> = [];

vi.mock("../db.server", () => ({
  default: {
    trustCertification: {
      findUnique: vi.fn(async ({ where }: { where: { storeId: string } }) => rows.get(where.storeId) ?? null),
      upsert: vi.fn(async ({ where, create, update }: { where: { storeId: string }; create: FakeRow; update: Partial<FakeRow> }) => {
        const existing = rows.get(where.storeId);
        const next = existing ? { ...existing, ...update } : { ...create };
        rows.set(where.storeId, next as FakeRow);
        return next;
      }),
      update: vi.fn(async ({ where, data }: { where: { storeId: string }; data: Partial<FakeRow> }) => {
        const existing = rows.get(where.storeId);
        if (!existing) throw new Error("not found");
        const next = { ...existing, ...data };
        rows.set(where.storeId, next);
        return next;
      }),
    },
    review: {
      findMany: vi.fn(async () => verifiedReviewsFixture),
    },
  },
}));

const {
  recalculateTrustCertification,
  getTrustCertification,
  setTrustCertificationPaused,
  refreshTrustCertification,
  getOrRefreshTrustCertification,
} = await import("./trustCertification.server");

const OLD_ENOUGH_SHOP = new Date("2020-01-01T00:00:00Z");
const REAL_GATEWAY = [["shopify_payments"]];
const REAL_POLICIES = {
  refundPolicyBody: "Refunds are available within 30 days of delivery for unused items in original condition.",
  shippingPolicyBody: "We ship within 2 business days; delivery typically takes 5-7 business days depending on destination.",
};
const VERIFIED_REVIEWS_ALL_PUBLISHED = Array.from({ length: 10 }, () => verifiedReview(ReviewStatus.APPROVED));

describe("recalculateTrustCertification", () => {
  beforeEach(() => {
    rows = new Map();
  });

  it("returns certified and persists it when every pillar genuinely passes", async () => {
    const snapshot = await recalculateTrustCertification("store-1", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: REAL_GATEWAY,
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });

    expect(snapshot.status).toBe("certified");
    expect(snapshot.everCertified).toBe(true);
    expect(snapshot.certifiedAt).not.toBeNull();

    const persisted = await getTrustCertification("store-1");
    expect(persisted?.status).toBe("certified");
  });

  it("transitions to at_risk (not not_certified) once a previously-certified store starts failing a pillar", async () => {
    await recalculateTrustCertification("store-2", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: REAL_GATEWAY,
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });

    // Same store, now failing the payment-methods pillar.
    const second = await recalculateTrustCertification("store-2", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: [["bogus"]],
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });

    expect(second.status).toBe("at_risk");
    expect(second.everCertified).toBe(true);
  });

  it("never marks everCertified for a store that has never actually passed every pillar", async () => {
    const snapshot = await recalculateTrustCertification("store-3", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: [["bogus"]],
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });

    expect(snapshot.status).toBe("not_certified");
    expect(snapshot.everCertified).toBe(false);
  });

  it("preserves an existing paused flag across recalculation", async () => {
    await recalculateTrustCertification("store-4", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: REAL_GATEWAY,
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });
    await setTrustCertificationPaused("store-4", true);

    const snapshot = await recalculateTrustCertification("store-4", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: REAL_GATEWAY,
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });

    expect(snapshot.status).toBe("paused");
  });
});

describe("getTrustCertification", () => {
  beforeEach(() => {
    rows = new Map();
  });

  it("returns null when no calculation has ever run for this store", async () => {
    const result = await getTrustCertification("never-calculated");
    expect(result).toBeNull();
  });
});

describe("setTrustCertificationPaused", () => {
  beforeEach(() => {
    rows = new Map();
  });

  it("is a no-op when no calculation has ever run yet", async () => {
    await expect(setTrustCertificationPaused("never-calculated", true)).resolves.toBeUndefined();
  });

  it("recomputes overall status from the stored pillars when unpausing", async () => {
    await recalculateTrustCertification("store-5", {
      verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED,
      orderGatewayNames: REAL_GATEWAY,
      policies: REAL_POLICIES,
      shopCreatedAt: OLD_ENOUGH_SHOP,
    });
    await setTrustCertificationPaused("store-5", true);
    await setTrustCertificationPaused("store-5", false);

    const result = await getTrustCertification("store-5");
    expect(result?.status).toBe("certified");
  });
});

// --- Admin API orchestration: refreshTrustCertification / getOrRefreshTrustCertification ---

type FakeGraphqlResponse = { data?: unknown; errors?: Array<{ message: string; extensions?: { code?: string } }> };

// A real, thrown GraphqlQueryError look-alike — confirmed live (2026-09) that
// @shopify/shopify-api's admin.graphql() REJECTS (rather than resolving with `.errors` in the
// JSON body) whenever the response is HTTP 200 with GraphQL-level errors. This is the exact
// shape adminGraphql's extractGraphqlErrorsFromRejection reads (error.body.errors.graphQLErrors).
function thrownGraphqlQueryError(errors: NonNullable<FakeGraphqlResponse["errors"]>): { body: { errors: { graphQLErrors: typeof errors } } } {
  return { body: { errors: { graphQLErrors: errors } } };
}

// A minimal stand-in for AdminApiContext — refreshTrustCertification only ever calls
// admin.graphql(query, { variables }) and reads response.json(), so that's all this needs to
// fake. Each entry is either a normal resolved response, or `{ throws: ... }` to simulate the
// real GraphqlQueryError rejection path. Consumed in call order (orders, then shop.createdAt,
// then policies), matching the real Promise.all invocation order inside refreshTrustCertification.
function fakeAdmin(responses: Array<FakeGraphqlResponse | { throws: unknown }>) {
  let call = 0;
  return {
    graphql: vi.fn(async () => {
      const entry = responses[call++] ?? {};
      if (entry && typeof entry === "object" && "throws" in entry) {
        throw entry.throws;
      }
      return { json: async () => entry };
    }),
  } as unknown as Parameters<typeof refreshTrustCertification>[0];
}

const REAL_ORDERS_RESPONSE: FakeGraphqlResponse = {
  data: { orders: { edges: [{ node: { paymentGatewayNames: ["shopify_payments"] } }] } },
};
const OLD_SHOP_RESPONSE: FakeGraphqlResponse = { data: { shop: { createdAt: "2020-01-01T00:00:00Z" } } };
const REAL_POLICIES_RESPONSE: FakeGraphqlResponse = {
  data: {
    shop: {
      shopPolicies: [
        { type: "REFUND_POLICY", body: REAL_POLICIES.refundPolicyBody },
        { type: "SHIPPING_POLICY", body: REAL_POLICIES.shippingPolicyBody },
      ],
    },
  },
};
const ACCESS_DENIED_POLICIES_RESPONSE: FakeGraphqlResponse = {
  errors: [
    {
      message: "Access denied for shopPolicies field. Required access: read_legal_policies access scope.",
      extensions: { code: "ACCESS_DENIED" },
    },
  ],
};

describe("refreshTrustCertification", () => {
  beforeEach(() => {
    rows = new Map();
    verifiedReviewsFixture = VERIFIED_REVIEWS_ALL_PUBLISHED;
  });

  it("certifies a store when real Shopify data clears every pillar", async () => {
    const admin = fakeAdmin([REAL_ORDERS_RESPONSE, OLD_SHOP_RESPONSE, REAL_POLICIES_RESPONSE]);
    const snapshot = await refreshTrustCertification(admin, "store-live-1");
    expect(snapshot.status).toBe("certified");
  });

  it("reports needs_permission for the policy pillar when Shopify denies shopPolicies for the missing scope (resolved-with-errors shape)", async () => {
    const admin = fakeAdmin([REAL_ORDERS_RESPONSE, OLD_SHOP_RESPONSE, ACCESS_DENIED_POLICIES_RESPONSE]);
    const snapshot = await refreshTrustCertification(admin, "store-live-2");
    expect(snapshot.pillars.policy.status).toBe("needs_permission");
    expect(snapshot.status).toBe("needs_permission");
  });

  // Regression test for a real production bug: admin.graphql() doesn't resolve with `.errors`
  // for this query — it REJECTS with a GraphqlQueryError, confirmed live against verveonline's
  // real ungranted read_legal_policies scope. Before adminGraphql's try/catch normalization was
  // added, this crashed the entire Dashboard loader with an uncaught exception for every
  // merchant, every load, since this scope is never granted yet.
  it("reports needs_permission when admin.graphql() throws a GraphqlQueryError for the missing scope (real SDK shape)", async () => {
    const admin = fakeAdmin([
      REAL_ORDERS_RESPONSE,
      OLD_SHOP_RESPONSE,
      {
        throws: thrownGraphqlQueryError([
          {
            message: "Access denied for shopPolicies field. Required access: `read_legal_policies` access scope.",
            extensions: { code: "ACCESS_DENIED" },
          },
        ]),
      },
    ]);
    const snapshot = await refreshTrustCertification(admin, "store-live-2b");
    expect(snapshot.pillars.policy.status).toBe("needs_permission");
    expect(snapshot.status).toBe("needs_permission");
  });

  it("propagates a real, unrelated GraphQL error instead of masking it as needs_permission", async () => {
    const admin = fakeAdmin([
      REAL_ORDERS_RESPONSE,
      OLD_SHOP_RESPONSE,
      { errors: [{ message: "Something else went wrong.", extensions: { code: "INTERNAL_SERVER_ERROR" } }] },
    ]);
    await expect(refreshTrustCertification(admin, "store-live-3")).rejects.toThrow("Something else went wrong.");
  });

  it("propagates a real, unrelated thrown error too (not just the resolved-with-errors shape)", async () => {
    const admin = fakeAdmin([
      REAL_ORDERS_RESPONSE,
      OLD_SHOP_RESPONSE,
      {
        throws: thrownGraphqlQueryError([
          { message: "Something else went wrong.", extensions: { code: "INTERNAL_SERVER_ERROR" } },
        ]),
      },
    ]);
    await expect(refreshTrustCertification(admin, "store-live-3b")).rejects.toThrow("Something else went wrong.");
  });

  it("reflects zero real orders as a pending payment-methods pillar, never a fabricated pass", async () => {
    const admin = fakeAdmin([
      { data: { orders: { edges: [] } } },
      OLD_SHOP_RESPONSE,
      REAL_POLICIES_RESPONSE,
    ]);
    const snapshot = await refreshTrustCertification(admin, "store-live-4");
    expect(snapshot.pillars.paymentMethods.status).toBe("pending");
  });
});

describe("getOrRefreshTrustCertification", () => {
  beforeEach(() => {
    rows = new Map();
    verifiedReviewsFixture = VERIFIED_REVIEWS_ALL_PUBLISHED;
  });

  it("runs a real refresh when no snapshot has ever been calculated", async () => {
    const admin = fakeAdmin([REAL_ORDERS_RESPONSE, OLD_SHOP_RESPONSE, REAL_POLICIES_RESPONSE]);
    const result = await getOrRefreshTrustCertification(admin, "store-fresh");
    expect(result.status).toBe("certified");
    expect(admin.graphql).toHaveBeenCalled();
  });

  it("returns the cached snapshot immediately without calling Shopify when it is still fresh", async () => {
    await recalculateTrustCertification(
      "store-fresh-cache",
      { verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED, orderGatewayNames: REAL_GATEWAY, policies: REAL_POLICIES, shopCreatedAt: OLD_ENOUGH_SHOP },
      new Date(),
    );

    const admin = fakeAdmin([]);
    const result = await getOrRefreshTrustCertification(admin, "store-fresh-cache");
    expect(result.status).toBe("certified");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("returns the stale cached snapshot but kicks off a background refresh", async () => {
    const staleTime = new Date(Date.now() - TRUST_CERTIFICATION_STALE_MS - 1000);
    await recalculateTrustCertification(
      "store-stale",
      { verifiedReviews: VERIFIED_REVIEWS_ALL_PUBLISHED, orderGatewayNames: [["bogus"]], policies: REAL_POLICIES, shopCreatedAt: OLD_ENOUGH_SHOP },
      staleTime,
    );

    const admin = fakeAdmin([REAL_ORDERS_RESPONSE, OLD_SHOP_RESPONSE, REAL_POLICIES_RESPONSE]);
    const result = await getOrRefreshTrustCertification(admin, "store-stale");

    // The returned value is the stale snapshot itself (not_certified, from the test-mode-only
    // gateway set above) — the refresh happens in the background for *next* time, it must
    // never block or silently replace what this call returns.
    expect(result.status).toBe("not_certified");
    expect(admin.graphql).toHaveBeenCalled();
  });
});
