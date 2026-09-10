import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { ReviewStatus } from "./review.shared";
import { MIN_VERIFIED_REVIEWS, REVIEW_PRACTICES_THRESHOLD } from "./trustCertification.presentation";

// IMAGYN Trust Certification — see the TrustCertification model's own header comment in
// schema.prisma for the full architectural rationale. This file is the ONLY place any pillar
// status is decided; every function below is a pure calculator over already-fetched real
// data, so each one is independently unit-testable without mocking the Shopify SDK, and the
// thin orchestration function at the bottom (refreshTrustCertification) is the only place
// that actually calls the Admin API. No function here ever accepts a "just mark this met"
// input from a caller — that would be exactly the fabricated-certification pattern this
// feature exists to avoid.

export type PillarStatus = "met" | "not_met" | "pending" | "needs_permission";
export type OverallStatus = "certified" | "pending" | "at_risk" | "paused" | "not_certified" | "needs_permission";

// Real, deliberate thresholds — not tunable per merchant (that would let a store lower the
// bar until it passes, which is exactly what "no fake certification" prohibits). Canonical
// values live in trustCertification.presentation.ts (see its own comment); re-exported here
// so every existing import of these two names from this file keeps working unchanged.
export { MIN_VERIFIED_REVIEWS, REVIEW_PRACTICES_THRESHOLD };
const MIN_STORE_AGE_DAYS = 90; // ~3 months

export interface ReviewPracticesResult {
  status: PillarStatus;
  percent: number | null;
  reason: string | null;
  verifiedReviewCount: number;
  verifiedAverageRating: number;
}

// Pillar 1 — Transparent Review Practices. Counts ONLY verifiedPurchase reviews (unverified
// reviews never contribute to this pillar, per the explicit requirement) and asks what share
// of those are actually published (APPROVED). A store that verifies purchases but then
// suppresses the unflattering ones fails this pillar; that is the entire point of it.
export function calculateReviewPracticesPillar(
  verifiedReviews: Array<{ status: string; rating: number }>,
): ReviewPracticesResult {
  const verifiedReviewCount = verifiedReviews.length;

  if (verifiedReviewCount === 0) {
    return { status: "pending", percent: null, reason: null, verifiedReviewCount: 0, verifiedAverageRating: 0 };
  }

  const publishedCount = verifiedReviews.filter((r) => r.status === ReviewStatus.APPROVED).length;
  const percent = Math.round((publishedCount / verifiedReviewCount) * 1000) / 10; // one decimal
  const verifiedAverageRating =
    Math.round((verifiedReviews.reduce((sum, r) => sum + r.rating, 0) / verifiedReviewCount) * 10) / 10;

  if (verifiedReviewCount < MIN_VERIFIED_REVIEWS) {
    return {
      status: "pending",
      percent,
      reason: `Only ${verifiedReviewCount} of the required ${MIN_VERIFIED_REVIEWS} verified reviews collected so far.`,
      verifiedReviewCount,
      verifiedAverageRating,
    };
  }

  if (percent >= REVIEW_PRACTICES_THRESHOLD) {
    return { status: "met", percent, reason: null, verifiedReviewCount, verifiedAverageRating };
  }

  return {
    status: "not_met",
    percent,
    reason: `${percent}% of verified reviews are published — ${REVIEW_PRACTICES_THRESHOLD}% is required.`,
    verifiedReviewCount,
    verifiedAverageRating,
  };
}

// Gateway names Shopify orders can report that do NOT give a customer any dispute/chargeback
// path — matched case-insensitively against Order.paymentGatewayNames. Deliberately a
// denylist, not an allowlist: a denylist degrades safely (an unfamiliar real gateway name is
// treated as secure, which is usually correct — card networks/PayPal/BNPL providers all
// support disputes), whereas an allowlist would incorrectly fail every gateway not already on
// it. "bogus"/"free" are Shopify's own test-mode gateways — excluded so a development store
// never reads as falsely secure from test orders.
const NO_DISPUTE_PATH_GATEWAYS = new Set([
  "manual",
  "cash on delivery (cod)",
  "cash_on_delivery",
  "cod",
  "bank_deposit",
  "money_order",
  "bogus",
  "free",
]);

export interface PaymentMethodsResult {
  status: PillarStatus;
  detail: string | null;
}

// Pillar 2 — Secure Payment Methods. Real signal only: Order.paymentGatewayNames from actual
// orders (existing read_orders scope — no new permission). Never infers anything from
// shop.paymentSettings (confirmed via live introspection that field only exposes
// autoCapture/supportedDigitalWallets, not which gateways are configured) and never assumes
// manual/COD is secure just because it's present.
//
// This intentionally has no "needs_permission" state (unlike the Policy pillar): read_orders
// is already an unconditionally-granted scope with no additional consent gate, so there is no
// real scenario where this data is permission-blocked — inventing one here would itself be a
// fabricated state. A store with COD *and* a real gateway is correctly "met", never penalized
// for the COD orders alone — see calculatePaymentMethodsPillar's own `.some()` (not `.every()`)
// below, and the explicit COD/mixed-provider regression tests in this file's test suite.
export function calculatePaymentMethodsPillar(orderGatewayNames: string[][]): PaymentMethodsResult {
  if (orderGatewayNames.length === 0) {
    return { status: "pending", detail: "No orders yet to determine which payment methods customers actually use." };
  }

  const allNames = orderGatewayNames.flat().map((name) => name.trim().toLowerCase());
  const distinctNames = Array.from(new Set(allNames)).filter(Boolean);
  const hasDisputablePath = distinctNames.some((name) => !NO_DISPUTE_PATH_GATEWAYS.has(name));

  if (hasDisputablePath) {
    return { status: "met", detail: "At least one payment method with a real dispute/chargeback path is in use." };
  }

  return {
    status: "not_met",
    detail: "Every recent order used a payment method with no dispute/chargeback path (e.g. manual or cash on delivery).",
  };
}

export interface PolicyResult {
  status: PillarStatus;
  detail: string | null;
}

const TIMEFRAME_PATTERN = /\b\d+\s*(day|days|business day|business days|week|weeks)\b/i;
// `s?` handles the plural forms merchants actually write ("Refunds are...", "Returns
// accepted...") — an earlier version used \brefund\b/\breturn\b, which a word-boundary regex
// never matches inside "Refunds"/"Returns" since there's no boundary between "d"/"n" and a
// trailing "s". Caught by this file's own regression test.
const REFUND_KEYWORD_PATTERN = /\b(refunds?|returns?|exchanges?)\b/i;
const SHIPPING_KEYWORD_PATTERN = /\b(ships?|shipping|delivers?|delivery|deliveries)\b/i;
const MIN_POLICY_BODY_LENGTH = 80; // strips out a placeholder one-liner, not a real policy

function stripHtml(body: string): string {
  return body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isMeaningfulPolicy(body: string | null | undefined, keywordPattern: RegExp): { ok: boolean; reason: string } {
  if (!body) return { ok: false, reason: "not published" };
  const text = stripHtml(body);
  if (text.length < MIN_POLICY_BODY_LENGTH) return { ok: false, reason: "too short to be a real policy" };
  if (!keywordPattern.test(text)) return { ok: false, reason: "missing the relevant terms" };
  if (!TIMEFRAME_PATTERN.test(text)) return { ok: false, reason: "missing a stated timeframe" };
  return { ok: true, reason: "" };
}

// Pillar 3 — Transparent Shipping & Refund Policy. Requires shop.shopPolicies, which requires
// the `read_legal_policies` Admin API scope — confirmed via live GraphQL introspection against
// this app's real, currently-granted scopes that the field is ACCESS_DENIED without it. Until
// that scope is added and merchants re-consent, this pillar is honestly "needs_permission",
// never silently skipped or assumed passing. Once readable, a policy only counts as meaningful
// if it actually states a timeframe — "policy exists" alone is explicitly not sufficient
// (matches the requirement to not use a simplistic exists-check).
export function calculatePolicyPillar(
  policies: { refundPolicyBody: string | null; shippingPolicyBody: string | null } | null,
): PolicyResult {
  if (policies === null) {
    return { status: "needs_permission", detail: "Requires the read_legal_policies scope, which isn't granted yet." };
  }

  const refund = isMeaningfulPolicy(policies.refundPolicyBody, REFUND_KEYWORD_PATTERN);
  const shipping = isMeaningfulPolicy(policies.shippingPolicyBody, SHIPPING_KEYWORD_PATTERN);

  if (refund.ok && shipping.ok) {
    return { status: "met", detail: "Both refund and shipping policies state real terms and a timeframe." };
  }

  const problems: string[] = [];
  if (!refund.ok) problems.push(`Refund policy ${refund.reason}`);
  if (!shipping.ok) problems.push(`Shipping policy ${shipping.reason}`);

  return { status: "not_met", detail: problems.join("; ") + "." };
}

export interface StoreHistoryResult {
  status: PillarStatus;
  detail: string | null;
}

// Pillar 4 — Verified Store History. shop.createdAt needs no extra scope. "Good standing"
// beyond store age is not something this API surface can honestly prove for a third-party
// app (Shopify exposes no "is this shop suspended/flagged" field to apps) — the fact that
// this query succeeded at all (the shop's Admin API is reachable and answering) is the only
// real, non-fabricated proxy available, and is stated as exactly that rather than claimed as
// a stronger guarantee.
export function calculateStoreHistoryPillar(shopCreatedAt: Date, now: Date = new Date()): StoreHistoryResult {
  const ageDays = Math.floor((now.getTime() - shopCreatedAt.getTime()) / (1000 * 60 * 60 * 24));
  const ageMonths = Math.floor(ageDays / 30);

  if (ageDays >= MIN_STORE_AGE_DAYS) {
    return {
      status: "met",
      detail: `Store has been active for ${ageMonths >= 1 ? `${ageMonths} month${ageMonths === 1 ? "" : "s"}` : `${ageDays} days`}.`,
    };
  }

  return { status: "not_met", detail: `Store is ${ageDays} day${ageDays === 1 ? "" : "s"} old — at least ${MIN_STORE_AGE_DAYS} days required.` };
}

export interface TrustPillars {
  reviewPractices: ReviewPracticesResult;
  paymentMethods: PaymentMethodsResult;
  policy: PolicyResult;
  storeHistory: StoreHistoryResult;
}

// The one function that turns four independent pillar results into a single merchant-facing
// status. Priority order is deliberate: a real, proven failure (not_met) always outranks an
// unresolved one (pending/needs_permission) — a store that is actively failing a pillar
// should never be described as merely "pending" just because a different pillar also
// happens to lack data yet.
export function deriveOverallStatus(pillars: TrustPillars, paused: boolean, everCertified: boolean): OverallStatus {
  if (paused) return "paused";

  const statuses = [pillars.reviewPractices.status, pillars.paymentMethods.status, pillars.policy.status, pillars.storeHistory.status];

  if (statuses.includes("not_met")) {
    return everCertified ? "at_risk" : "not_certified";
  }
  if (statuses.includes("needs_permission")) {
    return "needs_permission";
  }
  if (statuses.includes("pending")) {
    return "pending";
  }
  return "certified";
}

export interface TrustCertificationSnapshot {
  status: OverallStatus;
  pillars: TrustPillars;
  verifiedReviewCount: number;
  verifiedAverageRating: number;
  paused: boolean;
  everCertified: boolean;
  certifiedAt: Date | null;
  lastCheckedAt: Date;
}

function toPrismaRow(storeId: string, snapshot: TrustCertificationSnapshot) {
  return {
    status: snapshot.status,
    reviewPracticesStatus: snapshot.pillars.reviewPractices.status,
    reviewPracticesPercent: snapshot.pillars.reviewPractices.percent,
    reviewPracticesReason: snapshot.pillars.reviewPractices.reason,
    paymentMethodsStatus: snapshot.pillars.paymentMethods.status,
    paymentMethodsDetail: snapshot.pillars.paymentMethods.detail,
    policyStatus: snapshot.pillars.policy.status,
    policyDetail: snapshot.pillars.policy.detail,
    storeHistoryStatus: snapshot.pillars.storeHistory.status,
    storeHistoryDetail: snapshot.pillars.storeHistory.detail,
    verifiedReviewCount: snapshot.verifiedReviewCount,
    verifiedAverageRating: snapshot.verifiedAverageRating,
    paused: snapshot.paused,
    everCertified: snapshot.everCertified,
    certifiedAt: snapshot.certifiedAt,
    lastCheckedAt: snapshot.lastCheckedAt,
  };
}

// Real orchestration: fetches real Review rows (already-owned Prisma data, no Admin API call)
// plus real Shopify data the caller has already fetched (orders, policies, shop.createdAt) —
// this function itself never calls the Admin API, so it stays trivially testable and the
// route layer stays the only place that needs a real `admin` client.
export async function recalculateTrustCertification(
  storeId: string,
  input: {
    verifiedReviews: Array<{ status: string; rating: number }>;
    orderGatewayNames: string[][];
    policies: { refundPolicyBody: string | null; shippingPolicyBody: string | null } | null;
    shopCreatedAt: Date;
  },
  now: Date = new Date(),
): Promise<TrustCertificationSnapshot> {
  const existing = await prisma.trustCertification.findUnique({ where: { storeId } });

  const reviewPractices = calculateReviewPracticesPillar(input.verifiedReviews);
  const paymentMethods = calculatePaymentMethodsPillar(input.orderGatewayNames);
  const policy = calculatePolicyPillar(input.policies);
  const storeHistory = calculateStoreHistoryPillar(input.shopCreatedAt, now);
  const pillars: TrustPillars = { reviewPractices, paymentMethods, policy, storeHistory };

  const paused = existing?.paused ?? false;
  const everCertifiedSoFar = existing?.everCertified ?? false;
  const status = deriveOverallStatus(pillars, paused, everCertifiedSoFar);
  const nowCertified = status === "certified";

  const snapshot: TrustCertificationSnapshot = {
    status,
    pillars,
    verifiedReviewCount: reviewPractices.verifiedReviewCount,
    verifiedAverageRating: reviewPractices.verifiedAverageRating,
    paused,
    everCertified: everCertifiedSoFar || nowCertified,
    certifiedAt: nowCertified ? (existing?.certifiedAt ?? now) : (existing?.certifiedAt ?? null),
    lastCheckedAt: now,
  };

  const row = toPrismaRow(storeId, snapshot);
  await prisma.trustCertification.upsert({
    where: { storeId },
    create: { storeId, ...row },
    update: row,
  });

  return snapshot;
}

// Pure cache read — never triggers a recalculation or an Admin API call. Every read-only
// surface (Dashboard, Trust Badge) should call this, matching aiSummary.server.ts's own
// getAiSummary convention.
export async function getTrustCertification(storeId: string): Promise<TrustCertificationSnapshot | null> {
  const row = await prisma.trustCertification.findUnique({ where: { storeId } });
  if (!row) return null;

  return {
    status: row.status as OverallStatus,
    pillars: {
      reviewPractices: {
        status: row.reviewPracticesStatus as PillarStatus,
        percent: row.reviewPracticesPercent,
        reason: row.reviewPracticesReason,
        verifiedReviewCount: row.verifiedReviewCount,
        verifiedAverageRating: row.verifiedAverageRating,
      },
      paymentMethods: { status: row.paymentMethodsStatus as PillarStatus, detail: row.paymentMethodsDetail },
      policy: { status: row.policyStatus as PillarStatus, detail: row.policyDetail },
      storeHistory: { status: row.storeHistoryStatus as PillarStatus, detail: row.storeHistoryDetail },
    },
    verifiedReviewCount: row.verifiedReviewCount,
    verifiedAverageRating: row.verifiedAverageRating,
    paused: row.paused,
    everCertified: row.everCertified,
    certifiedAt: row.certifiedAt,
    lastCheckedAt: row.lastCheckedAt,
  };
}

// Merchant control: pauses *display* of the badge/certified state without ever touching a
// pillar's own calculated status — the next recalculation still computes real pillar values,
// they're just not surfaced as "certified" while paused. Never a way to force a pillar or the
// overall status to a specific value.
export async function setTrustCertificationPaused(storeId: string, paused: boolean): Promise<void> {
  const existing = await prisma.trustCertification.findUnique({ where: { storeId } });
  if (!existing) return; // Nothing to pause until a first real calculation has ever run.

  const pillars: TrustPillars = {
    reviewPractices: {
      status: existing.reviewPracticesStatus as PillarStatus,
      percent: existing.reviewPracticesPercent,
      reason: existing.reviewPracticesReason,
      verifiedReviewCount: existing.verifiedReviewCount,
      verifiedAverageRating: existing.verifiedAverageRating,
    },
    paymentMethods: { status: existing.paymentMethodsStatus as PillarStatus, detail: existing.paymentMethodsDetail },
    policy: { status: existing.policyStatus as PillarStatus, detail: existing.policyDetail },
    storeHistory: { status: existing.storeHistoryStatus as PillarStatus, detail: existing.storeHistoryDetail },
  };

  const status = deriveOverallStatus(pillars, paused, existing.everCertified);

  await prisma.trustCertification.update({
    where: { storeId },
    data: { paused, status },
  });
}

export const MIN_STORE_AGE_DAYS_EXPORT = MIN_STORE_AGE_DAYS;

// ---------------------------------------------------------------------------
// Real Admin API orchestration — the only part of this file that performs I/O
// against Shopify. Every other export above is a pure calculator; this is the
// thin seam that feeds them real data. Kept deliberately small: one query per
// real fact needed, no speculative fields, no fabrication on failure.
// ---------------------------------------------------------------------------

const ORDER_SAMPLE_SIZE = 50;

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

// Confirmed live (2026-09) against this app's real @shopify/shopify-api client: admin.graphql()
// does NOT just resolve with an `errors` array in the JSON body for a GraphQL-level error (e.g.
// ACCESS_DENIED) — it REJECTS the promise with a GraphqlQueryError, even on an HTTP 200. That
// error's real shape is `{ body: { errors: { graphQLErrors: [...] } } }` (see
// node_modules/@shopify/shopify-api's throwFailedRequest). Every pillar query here can
// legitimately hit this (most reliably the policies query, before read_legal_policies is
// granted), so this helper normalizes both possible outcomes into one GraphqlEnvelope shape —
// every caller below can keep checking `envelope.errors` without needing to know which path
// the SDK actually took.
function extractGraphqlErrorsFromRejection(error: unknown): GraphqlEnvelope<never>["errors"] | undefined {
  if (typeof error !== "object" || error === null || !("body" in error)) return undefined;
  const body = (error as { body?: { errors?: { graphQLErrors?: GraphqlEnvelope<never>["errors"] } } }).body;
  return body?.errors?.graphQLErrors;
}

async function adminGraphql<T>(
  admin: AdminApiContext,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphqlEnvelope<T>> {
  try {
    const response = await admin.graphql(query, variables ? { variables } : undefined);
    return (await response.json()) as GraphqlEnvelope<T>;
  } catch (error) {
    const graphQLErrors = extractGraphqlErrorsFromRejection(error);
    if (graphQLErrors?.length) {
      return { errors: graphQLErrors };
    }
    throw error;
  }
}

interface OrdersGatewayNamesResult {
  orders: { edges: Array<{ node: { paymentGatewayNames: string[] } }> };
}

// Real Order.paymentGatewayNames off the existing read_orders scope (already granted, no new
// permission needed — confirmed via live introspection). Sampled over the most recent orders
// rather than the whole order history: recent payment behavior is what "secure payment methods
// in use" actually needs to answer, and an unbounded scan would be a real, avoidable cost.
async function fetchRecentOrderGatewayNames(admin: AdminApiContext): Promise<string[][]> {
  const envelope = await adminGraphql<OrdersGatewayNamesResult>(
    admin,
    `#graphql
    query TrustCertificationOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges { node { paymentGatewayNames } }
      }
    }`,
    { first: ORDER_SAMPLE_SIZE },
  );

  if (envelope.errors?.length) {
    throw new Error(envelope.errors.map((error) => error.message).join(" "));
  }

  return (envelope.data?.orders.edges ?? []).map((edge) => edge.node.paymentGatewayNames);
}

interface ShopCreatedAtResult {
  shop: { createdAt: string };
}

// shop.createdAt needs no scope beyond what every embedded app already has.
async function fetchShopCreatedAt(admin: AdminApiContext): Promise<Date> {
  const envelope = await adminGraphql<ShopCreatedAtResult>(
    admin,
    `#graphql
    query TrustCertificationShopCreatedAt {
      shop { createdAt }
    }`,
  );

  if (envelope.errors?.length || !envelope.data) {
    throw new Error(envelope.errors?.map((error) => error.message).join(" ") || "Shopify did not return shop data.");
  }

  return new Date(envelope.data.shop.createdAt);
}

interface ShopPoliciesResult {
  shop: { shopPolicies: Array<{ type: string; body: string }> };
}

// Confirmed live (2026-09) that shop.shopPolicies is ACCESS_DENIED without the
// read_legal_policies scope, which isn't in shopify.app.toml yet — that's the one error this
// function treats as an expected, honest "needs_permission" outcome (returns null) rather than
// a failure. Any other error is a real problem and should surface as one, not be silently
// swallowed into a false "needs_permission" reading.
function isLegalPoliciesAccessDenied(errors: GraphqlEnvelope<unknown>["errors"]): boolean {
  return Boolean(
    errors?.some(
      (error) => error.extensions?.code === "ACCESS_DENIED" && /read_legal_policies/i.test(error.message),
    ),
  );
}

async function fetchShopPolicies(
  admin: AdminApiContext,
): Promise<{ refundPolicyBody: string | null; shippingPolicyBody: string | null } | null> {
  const envelope = await adminGraphql<ShopPoliciesResult>(
    admin,
    `#graphql
    query TrustCertificationPolicies {
      shop { shopPolicies { type body } }
    }`,
  );

  if (isLegalPoliciesAccessDenied(envelope.errors)) {
    return null;
  }

  if (envelope.errors?.length || !envelope.data) {
    throw new Error(
      envelope.errors?.map((error) => error.message).join(" ") || "Shopify did not return shop policy data.",
    );
  }

  const policies = envelope.data.shop.shopPolicies;
  return {
    refundPolicyBody: policies.find((policy) => policy.type === "REFUND_POLICY")?.body ?? null,
    shippingPolicyBody: policies.find((policy) => policy.type === "SHIPPING_POLICY")?.body ?? null,
  };
}

// The single entry point route/action code should call. Fetches every real input in parallel
// (Prisma's own Review table for verified reviews — no Admin API needed there — plus the three
// live Shopify queries above) and hands them to recalculateTrustCertification, which is the
// only place the actual pillar/status logic lives.
export async function refreshTrustCertification(
  admin: AdminApiContext,
  storeId: string,
): Promise<TrustCertificationSnapshot> {
  const [verifiedReviews, orderGatewayNames, shopCreatedAt, policies] = await Promise.all([
    prisma.review.findMany({
      where: { storeId, deletedAt: null, verifiedPurchase: true },
      select: { status: true, rating: true },
    }),
    fetchRecentOrderGatewayNames(admin),
    fetchShopCreatedAt(admin),
    fetchShopPolicies(admin),
  ]);

  return recalculateTrustCertification(storeId, { verifiedReviews, orderGatewayNames, policies, shopCreatedAt });
}

// How long a snapshot is trusted before the Dashboard silently triggers a real recalculation
// in the background of a normal page load — keeps the certification honestly current without
// making every single Dashboard visit pay for three extra Admin API calls.
export const TRUST_CERTIFICATION_STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

export function isTrustCertificationStale(lastCheckedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastCheckedAt.getTime() >= TRUST_CERTIFICATION_STALE_MS;
}

// Dashboard-facing read: returns the cached snapshot immediately, and refreshes it for next
// time if it's missing or stale — never blocks a normal page load on Shopify API latency by
// awaiting the refresh itself when a perfectly good (if slightly old) snapshot already exists.
export async function getOrRefreshTrustCertification(
  admin: AdminApiContext,
  storeId: string,
): Promise<TrustCertificationSnapshot> {
  const existing = await getTrustCertification(storeId);

  if (!existing) {
    return refreshTrustCertification(admin, storeId);
  }

  if (isTrustCertificationStale(existing.lastCheckedAt)) {
    refreshTrustCertification(admin, storeId).catch((error) => {
      console.error("Trust Certification background refresh failed:", error);
    });
  }

  return existing;
}
