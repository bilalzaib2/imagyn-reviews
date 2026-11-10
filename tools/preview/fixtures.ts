// Fixture data shaped exactly like each route's loader return.
//
// Deliberately hostile where it matters: long product titles, a long customer name, a long
// review body, mixed statuses and media counts. A fixture of tidy short strings would hide
// precisely the truncation and wrapping problems this harness exists to find.

const PRODUCTS = [
  "Brown Ceramic Plate - Rustic Charm for Every Meal",
  "Merino Wool Crew Neck Sweater — Charcoal, Unisex, Pre-Shrunk",
  "Trail 32L Backpack",
  "Cast Iron Skillet",
];

const BODIES = [
  "Arrived two days early and the finish is genuinely better than the photos suggest. I have washed it several times now with no fading at all, and the colour has held up perfectly.",
  "Comfortable and well made, though I would order a size up next time.",
  "The material feels thinner than described and one seam was already loose on arrival. Support replaced it quickly which I appreciated, and the replacement has been flawless.",
  "Exactly as described. Quick postage.",
];

const NAMES = ["Amelia Hartley", "Thomas Abernathy-Whitfield", "Yuki Tanaka", "Priya Raghunathan", "Dan O."];

function review(index: number) {
  const status = (["APPROVED", "PENDING", "REJECTED"] as const)[index % 3];
  return {
    id: `rev_${index}`,
    storeId: "store_1",
    productId: `prod_${index % PRODUCTS.length}`,
    productTitle: PRODUCTS[index % PRODUCTS.length],
    rating: (index % 5) + 1,
    title: ["Excellent quality and fast delivery", "Good but the sizing runs small", "Not what I expected", null][index % 4],
    content: BODIES[index % BODIES.length],
    reviewerName: NAMES[index % NAMES.length],
    reviewerEmail: "customer@example.com",
    reviewerLocation: "Manchester, UK",
    verifiedPurchase: index % 2 === 0,
    status,
    isPublished: status === "APPROVED",
    helpfulCount: index * 3,
    notHelpfulCount: 0,
    featured: index === 0,
    reply: index === 1 ? "Thanks so much for the kind words — glad it arrived early!" : null,
    repliedAt: index === 1 ? new Date("2026-11-02").toISOString() : null,
    photoUrls: null,
    deletedAt: null,
    archivedAt: null,
    hiddenReason: status === "REJECTED" ? "spam" : null,
    hiddenAt: status === "REJECTED" ? new Date("2026-11-03").toISOString() : null,
    moderationStatus: null,
    moderationReason: null,
    externalId: null,
    importSource: index === 3 ? "judgeme" : null,
    importBatchId: null,
    sourceVerified: null,
    createdAt: new Date(2026, 10, 1 + (index % 7)).toISOString(),
    updatedAt: new Date(2026, 10, 1 + (index % 7)).toISOString(),
    product: { id: `prod_${index % PRODUCTS.length}`, name: PRODUCTS[index % PRODUCTS.length] },
    media: index % 3 === 0 ? [{ id: `m_${index}`, type: "IMAGE", url: "", thumbnailUrl: "" }] : [],
    reward: null,
  };
}

export function reviewsLoaderData({ empty = false } = {}) {
  const reviews = empty ? [] : Array.from({ length: 12 }, (_, index) => review(index));

  return {
    reviews,
    statusCounts: empty
      ? { all: 0, archived: 0, PENDING: 0, APPROVED: 0, REJECTED: 0 }
      : { all: 83, archived: 6, PENDING: 12, APPROVED: 64, REJECTED: 7 },
    focusReviewId: "",
    focusReplyEditor: false,
    nextCursor: empty ? null : "rev_11",
    hasMore: !empty,
    totalCount: empty ? 0 : 83,
    aiSummaries: {},
    error: null,
    search: "",
    status: "",
    rating: "",
    product: "",
    dateFrom: "",
    dateTo: "",
    verifiedPurchase: false,
    archived: false,
    sort: "newest",
  };
}

function question(index: number) {
  const answered = index % 2 === 0;
  return {
    id: `q_${index}`,
    storeId: "store_1",
    productId: `prod_${index % PRODUCTS.length}`,
    productTitle: PRODUCTS[index % PRODUCTS.length],
    askerName: NAMES[index % NAMES.length],
    askerEmail: "customer@example.com",
    body: [
      "Is this dishwasher safe, or does the glaze need hand washing?",
      "Does it run true to size?",
      "How long does delivery usually take to the Highlands?",
    ][index % 3],
    answer: answered ? "Yes — it is dishwasher safe on the top rack. We'd avoid very long cycles." : null,
    answeredAt: answered ? new Date("2026-11-04").toISOString() : null,
    status: answered ? "PUBLISHED" : "PENDING",
    hiddenReason: null,
    hiddenAt: null,
    deletedAt: null,
    createdAt: new Date(2026, 10, 1 + index).toISOString(),
    updatedAt: new Date(2026, 10, 1 + index).toISOString(),
    product: { id: `prod_${index % PRODUCTS.length}`, name: PRODUCTS[index % PRODUCTS.length] },
  };
}

export function questionsLoaderData({ empty = false } = {}) {
  const questions = empty ? [] : Array.from({ length: 6 }, (_, index) => question(index));
  return {
    questions,
    totalCount: questions.length,
    counts: empty ? { all: 0, answered: 0, unanswered: 0 } : { all: 14, answered: 9, unanswered: 5 },
    tab: "",
    search: "",
  };
}

// --------------------------------------------------------------------- Dashboard

function pillar(status: string, percent: number, reason: string) {
  return { status, percent, reason };
}

export function dashboardLoaderData({ fresh = false } = {}) {
  // `fresh` is the state that matters most and is hardest to see any other way: a merchant
  // who installed sixty seconds ago, with nothing done and nothing collected.
  const stats = fresh
    ? {
        totalReviews: 0,
        publishedReviews: 0,
        pendingReviews: 0,
        averageRating: 0,
        recentReviews: [],
        autoPublishedToday: 0,
        heldByRules: 0,
        verifiedReviews: 0,
        ratingCounts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      }
    : {
        totalReviews: 83,
        publishedReviews: 64,
        pendingReviews: 12,
        averageRating: 4.6,
        recentReviews: reviewsLoaderData().reviews.slice(0, 5),
        autoPublishedToday: 3,
        heldByRules: 2,
        verifiedReviews: 51,
        ratingCounts: { 5: 48, 4: 19, 3: 9, 2: 5, 1: 2 },
      };

  return {
    storeName: "Verve Outdoor",
    storeDomain: "verveoutdoor.com",
    stats,
    requestStats: fresh
      ? { totalCount: 0, sent: 0, completed: 0, completionRate: 0, scheduled: 0, pending: 0 }
      : { totalCount: 240, sent: 212, completed: 83, completionRate: 0.39, scheduled: 18, pending: 10 },
    storeAiSummary: fresh
      ? null
      : {
          summary:
            "Customers consistently praise the build quality and the speed of delivery. The most common criticism is sizing, which several reviewers describe as running small.",
          recommendation: "Consider adding a sizing note to the product pages.",
          updatedAt: new Date("2026-11-06").toISOString(),
        },
    productCoverage: fresh ? { totalProducts: 12, withoutReviews: 12 } : { totalProducts: 12, withoutReviews: 4 },
    rewardStats: null,
    setupGuide: [
      { key: "plan", label: "Choose your plan", description: "Pick the plan that fits your store — Starter is free.", href: "/app/billing", done: !fresh },
      {
        key: "widget",
        label: "Set up your review widget",
        description:
          "Choose how reviews appear on your storefront, then add the widget to your theme — reviews only show once it is in place.",
        href: "/app/widgets",
        done: !fresh,
      },
      { key: "reviews", label: "Collect or import your first review", description: "Import from Judge.me, Loox, Stamped, or a generic CSV, or wait for your first customer review.", href: "/app/reviews", done: !fresh },
      { key: "requests", label: "Send your first review request", description: "Ask a real customer for a review from a Shopify order, a customer list, or a CSV upload.", href: "/app/requests", done: false },
      { key: "brand", label: "Customize your brand appearance", description: "Match your storefront's colors, fonts, and layout to your brand.", href: "/app/appearance", done: false },
    ],
    trust: {
      status: fresh ? "not_certified" : "certified",
      pillars: {
        reviewPractices: pillar(fresh ? "not_met" : "met", fresh ? 0 : 61, "Verified reviews as a share of all published reviews."),
        paymentMethods: pillar("met", 100, "A trusted payment method is enabled."),
        policy: pillar(fresh ? "unknown" : "met", 100, "A refund policy is published."),
        storeHistory: pillar("met", 100, "The store has been trading long enough."),
      },
      verifiedReviewCount: fresh ? 0 : 51,
      verifiedAverageRating: fresh ? 0 : 4.7,
      paused: false,
      everCertified: !fresh,
      certifiedAt: fresh ? null : new Date("2026-10-20").toISOString(),
      lastCheckedAt: new Date("2026-11-08").toISOString(),
    },
    appStoreUrl: null,
    automation: { isApproved: true, isLive: true, canUse: !fresh, isEnabled: !fresh },
  };
}

// ----------------------------------------------------------------- Brand Studio

import { getDefaultAppearanceTokens } from "../../app/services/appearance.shared";

/** Uses the REAL default tokens, so this is genuinely what a fresh install looks like. */
export function appearanceLoaderData({ fresh = true, pro = true } = {}) {
  return {
    tokens: getDefaultAppearanceTokens(),
    preset: "editorial",
    canUseBrandStudio: pro,
    savedThemes: fresh
      ? []
      : [
          { id: "t1", name: "Holiday", preset: "amber", createdAt: new Date("2026-10-01").toISOString() },
          { id: "t2", name: "Everyday", preset: "ink", createdAt: new Date("2026-09-12").toISOString() },
        ],
    surfaceOverrides: [],
  };
}

// ----------------------------------------------------------------- Email Studio

import { getDefaultEmailTemplateContent } from "../../app/services/email.shared";

/** Uses the real shipped defaults, so this is what a merchant who never opens the editor has. */
export function emailStudioLoaderData({ pro = true, withLogo = false } = {}) {
  return {
    type: "review_request" as const,
    content: getDefaultEmailTemplateContent("review_request"),
    storeName: "Verve Outdoor",
    canUseCustomBranding: pro,
    canUseEmailReminders: pro,
    canUseBrandedEmailSender: pro,
    emailSenderName: pro ? "Verve Outdoor" : null,
    senderIdentity: {
      displayName: "Verve Outdoor",
      fromAddress: "requests+verveoutdoor.com@notifications.imagyn.co",
      fromAddressIsMerchantScoped: true,
      fromAddressConfigured: true,
      replyTo: "hello@verveoutdoor.com",
      replyToSource: "verified-store",
    },
    sharedBranding: {
      emailLogoUrl: withLogo ? "https://cdn.shopify.com/s/files/1/0000/0000/files/logo.png" : null,
      emailLogoDarkUrl: null,
      // Always null now: the Admin API has no shop.brand (see shopBrandLogo.server.ts).
      shopBrandLogoUrl: null,
    },
  };
}

// ------------------------------------------------------------- Settings › Coupons

export function couponsLoaderData({ empty = false } = {}) {
  const coupons = empty
    ? []
    : [
        {
          id: "c1",
          name: "Thanks for reviewing",
          status: "active" as const,
          discountType: "percentage" as const,
          discountValue: 10,
          eligibility: "all" as const,
          minimumOrderAmount: 25,
          startsAt: new Date("2026-10-01").toISOString(),
          endsAt: new Date("2026-12-31").toISOString(),
          usageLimit: 500,
          perCustomerLimit: 1,
          customerTargeting: "all" as const,
          specificCustomerIds: [],
          shopifyDiscountId: "gid://shopify/DiscountCodeNode/123",
          discountCode: "THANKSFORR-9K2XQ1",
          createdAt: new Date("2026-10-01").toISOString(),
          updatedAt: new Date("2026-11-01").toISOString(),
          issuedCount: 3,
        },
        {
          id: "c2",
          name: "Winter photo reviews",
          status: "paused" as const,
          discountType: "fixed_amount" as const,
          discountValue: 5,
          eligibility: "new_customers" as const,
          minimumOrderAmount: null,
          startsAt: new Date("2026-11-01").toISOString(),
          endsAt: null,
          usageLimit: null,
          perCustomerLimit: 1,
          customerTargeting: "all" as const,
          specificCustomerIds: [],
          shopifyDiscountId: "gid://shopify/DiscountCodeNode/456",
          discountCode: "WINTERPHOT-4B8ZZ0",
          createdAt: new Date("2026-11-01").toISOString(),
          updatedAt: new Date("2026-11-05").toISOString(),
          issuedCount: 0,
        },
        {
          id: "c3",
          name: "Draft — spring campaign",
          status: "draft" as const,
          discountType: "percentage" as const,
          discountValue: 15,
          eligibility: "all" as const,
          minimumOrderAmount: null,
          startsAt: new Date("2026-11-08").toISOString(),
          endsAt: null,
          usageLimit: null,
          perCustomerLimit: 1,
          customerTargeting: "all" as const,
          specificCustomerIds: [],
          shopifyDiscountId: null,
          discountCode: null,
          createdAt: new Date("2026-11-08").toISOString(),
          updatedAt: new Date("2026-11-08").toISOString(),
          issuedCount: 0,
        },
      ];

  return {
    coupons,
    // Only campaigns that have issued anything appear here — matching the loader.
    redemptionsByCoupon: empty
      ? {}
      : {
          c1: [
            {
              id: "r1",
              couponId: "c1",
              customerEmail: "amelia.hartley@example.com",
              discountCode: "THANKSFORR-9K2XQ1-AB12",
              status: "issued" as const,
              reason: null,
              createdAt: new Date("2026-11-02").toISOString(),
            },
            {
              id: "r2",
              couponId: "c1",
              customerEmail: "thomas.abernathy-whitfield@example.com",
              discountCode: "THANKSFORR-9K2XQ1-CD34",
              status: "revoked" as const,
              reason: null,
              createdAt: new Date("2026-11-03").toISOString(),
            },
            {
              id: "r3",
              couponId: "c1",
              customerEmail: "yuki.tanaka@example.com",
              discountCode: null,
              status: "failed" as const,
              reason: "Shopify rejected the discount code.",
              createdAt: new Date("2026-11-04").toISOString(),
            },
          ],
        },
    storeDomain: "verveoutdoor.com",
  };
}

// --------------------------------------------------------- Settings › other screens

export function settingsRequestsLoaderData({ pro = true, enabled = true } = {}) {
  return {
    autoRequestEnabled: enabled,
    autoRequestDelayDays: 7,
    planIncludesAutomaticRequests: pro,
    reminderEmailsEnabled: enabled,
    planIncludesEmailReminders: pro,
    reminder1DelayDays: 3,
    reminderFinalDelayDays: 7,
  };
}

export function settingsModerationLoaderData({ enabled = true } = {}) {
  return {
    moderation: {
      enabled,
      minRating: 4,
      requireVerified: false,
      holdLinks: true,
      holdProfanity: true,
      bannedWords: "competitor\nscam",
      notifyOnHold: true,
      notifyEmail: "owner@verveoutdoor.com",
    },
    newReviewNotification: { enabled: true, email: "owner@verveoutdoor.com" },
  };
}

export function settingsSeoLoaderData({ pro = true } = {}) {
  return {
    canUseAI: pro,
    feed: { enabled: true, token: "feedtoken123", url: "https://app.imagyn.co/feeds/verveoutdoor/google.xml" },
    reviewSiteUrl: "https://app.imagyn.co/reviews-site/verve-outdoor",
    storeAiSummary: {
      summary: "Shoppers highlight build quality and fast delivery; sizing is the recurring criticism.",
      recommendation: "Add a sizing note to product pages.",
      reviewCountUsed: 64,
      generatedAt: new Date("2026-11-06").toISOString(),
    },
    aiSummaryOnProductReviewsEnabled: true,
    aiSummaryOnStoreReviewsEnabled: false,
    aiSummaryOnCarouselEnabled: false,
    aiSummaryOnReviewSiteEnabled: false,
    // Opt-in since 2026-11-08 — a fresh store is private until the merchant chooses.
    publicNetworkEnabled: false,
    isDevelopmentStore: false,
  };
}

export function settingsTrustLoaderData() {
  return { storeDomain: "verveoutdoor.com", trust: dashboardLoaderData().trust };
}

// ---------------------------------------------------------------------- Widgets

import { getDefaultWidgetSettings } from "../../app/services/widget.shared";

const INSTALL_KEYS = [
  "product-reviews-widget",
  "product-rating-badge",
  "collection-rating-badge",
  "review-carousel",
  "medals-showcase",
  "store-reviews",
  "ai-review-summary",
  "store-ai-summary",
] as const;

/**
 * `fresh` is a merchant who installed minutes ago: no saved widget, nothing in the theme.
 * `existing` has a configured widget and a mix of real detection outcomes, including the
 * "unknown" state — which is the one most likely to be rendered carelessly.
 */
export function widgetsLoaderData({ fresh = true, pro = true } = {}) {
  return {
    widgets: fresh
      ? []
      : [
          {
            id: "w1",
            storeId: "store_1",
            productId: null,
            name: "Product reviews",
            type: "review-list" as const,
            settings: getDefaultWidgetSettings("review-list"),
            createdAt: new Date("2026-10-02").toISOString(),
            updatedAt: new Date("2026-11-01").toISOString(),
          },
        ],
    shop: "verveonline.myshopify.com",
    error: null,
    canUseMultipleWidgetThemes: pro,
    canUseVideoReviewsCarousel: pro,
    proPlan: { name: "Pro", price: 15, currencyCode: "USD" },
    appearanceTokens: getDefaultAppearanceTokens(),
    installStatus: Object.fromEntries(
      INSTALL_KEYS.map((key, index) => [
        key,
        fresh
          ? { state: "not-installed" as const }
          : index === 0
            ? { state: "installed" as const, checkedUrl: "https://verveoutdoor.com/products/brown-ceramic-plate" }
            : index === 1
              ? { state: "unknown" as const, reason: "The storefront is password protected, so it could not be checked." }
              : { state: "not-installed" as const },
      ]),
    ),
  };
}

// -------------------------------------------------------------------- Analytics

export function analyticsLoaderData({ empty = false, pro = true } = {}) {
  const trend = empty
    ? []
    : Array.from({ length: 14 }, (_, i) => ({
        date: new Date(2026, 9, 27 + i).toISOString().slice(0, 10),
        count: [2, 5, 3, 8, 6, 4, 9, 7, 3, 5, 11, 6, 4, 8][i],
      }));

  return {
    range: "30d",
    reviewAnalytics: {
      range: "30d",
      totalReviews: empty ? 0 : 83,
      averageRating: empty ? 0 : 4.6,
      ratingCounts: empty ? { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } : { 1: 2, 2: 5, 3: 9, 4: 19, 5: 48 },
      statusCounts: empty
        ? { approved: 0, pending: 0, rejected: 0 }
        : { approved: 64, pending: 12, rejected: 7 },
      trend,
    },
    requestAnalytics: {
      range: "30d",
      totalRequests: empty ? 0 : 240,
      sent: empty ? 0 : 212,
      completed: empty ? 0 : 83,
      completionRate: empty ? 0 : 0.39,
      trend,
    },
    conversionInsights: {
      range: "30d",
      averageTimeToConversionHours: empty ? null : 41.5,
      bySource: empty
        ? []
        : [
            { source: "order", sent: 180, completed: 72, completionRate: 0.4 },
            { source: "manual", sent: 32, completed: 11, completionRate: 0.34 },
          ],
      byDelayBucket: empty
        ? []
        : [
            { bucket: "0–3 days", sent: 40, completed: 11, completionRate: 0.28 },
            { bucket: "4–7 days", sent: 120, completed: 55, completionRate: 0.46 },
            { bucket: "8+ days", sent: 52, completed: 17, completionRate: 0.33 },
          ],
    },
    aiDigest: empty || !pro
      ? null
      : [
          {
            productId: "prod_0",
            productName: "Brown Ceramic Plate - Rustic Charm for Every Meal",
            recommendation: "Add a dishwasher-safe note to the description.",
            positives: ["Weight and finish", "Arrives well packaged"],
            negatives: ["Unclear whether it is dishwasher safe"],
            reviewCountUsed: 31,
            generatedAt: new Date("2026-11-06").toISOString(),
          },
        ],
    canUseAnalytics: pro,
  };
}

// ------------------------------------------------- Settings › index, rewards, referrals

export function settingsIndexLoaderData({ pro = true } = {}) {
  return {
    planName: pro ? "Pro" : "Starter",
    autoRequestEnabled: true,
    reminderEmailsEnabled: true,
    reminder1DelayDays: 3,
    reminderFinalDelayDays: 7,
    canUseAutomaticReviewRequests: pro,
    canUseEmailReminders: pro,
    canUseCustomBranding: pro,
  };
}

export function settingsRewardsLoaderData({ enabled = true, empty = false } = {}) {
  return {
    settings: {
      enabled,
      valueType: "percentage" as const,
      value: 10,
      requireVerified: true,
      requirePhoto: false,
      requireVideo: false,
    },
    stats: empty
      ? { issued: 0, pending: 0, failed: 0, ineligible: 0 }
      : { issued: 42, pending: 1, failed: 2, ineligible: 17 },
  };
}

export function settingsReferralsLoaderData({ empty = false } = {}) {
  return {
    program: {
      id: "rp1",
      enabled: !empty,
      advocateRewardType: "percentage",
      advocateRewardValue: 10,
      friendRewardType: "percentage",
      friendRewardValue: 10,
      minimumOrderAmount: null,
      createdAt: new Date("2026-10-01").toISOString(),
      updatedAt: new Date("2026-11-01").toISOString(),
    },
    referrals: empty
      ? []
      : [
          {
            id: "ref1",
            advocateEmail: "amelia.hartley@example.com",
            code: "AMELIA-4F2X",
            clicks: 12,
            conversions: 3,
            createdAt: new Date("2026-10-20").toISOString(),
          },
        ],
  };
}

// --------------------------------------------------------------------- Requests

const REQUEST_STORE = {
  id: "store_1",
  name: "Verve Outdoor",
  domain: "verveoutdoor.com",
  emailSenderName: "Verve Outdoor",
  emailLogoUrl: null,
  emailLogoDarkUrl: null,
  shopBrandLogoUrl: null,
};

function reviewRequest(index: number) {
  // A spread of real lifecycle states, including the ones that are easy to render wrong:
  // scheduled but not sent, sent but never opened, and completed.
  const states = ["scheduled", "sent", "sent", "completed", "failed"] as const;
  const status = states[index % states.length];
  const sent = status !== "scheduled";
  const completed = status === "completed";

  return {
    id: `req_${index}`,
    name: NAMES[index % NAMES.length],
    email: `customer${index}@example.com`,
    orderNumber: `#10${40 + index}`,
    customMessage: index === 2 ? "Hope the plates arrived safely!" : null,
    requestToken: `tok_${index}`,
    delayDays: 7,
    scheduledFor: new Date(2026, 10, 1 + index).toISOString(),
    sentAt: sent ? new Date(2026, 10, 2 + index).toISOString() : null,
    openedAt: sent && index % 2 === 0 ? new Date(2026, 10, 3 + index).toISOString() : null,
    reviewedAt: completed ? new Date(2026, 10, 4 + index).toISOString() : null,
    status,
    source: index % 3 === 0 ? "order" : "manual",
    shopifyOrderId: index % 3 === 0 ? `gid://shopify/Order/${1000 + index}` : null,
    sendAttempts: status === "failed" ? 3 : 1,
    reminder1SentAt: sent && index % 2 === 1 ? new Date(2026, 10, 5 + index).toISOString() : null,
    reminderFinalSentAt: null,
    createdAt: new Date(2026, 10, 1 + index).toISOString(),
    updatedAt: new Date(2026, 10, 4 + index).toISOString(),
    store: REQUEST_STORE,
  };
}

export function requestsLoaderData({ empty = false, pro = true } = {}) {
  const requests = empty ? [] : Array.from({ length: 10 }, (_, i) => reviewRequest(i));
  return {
    requests,
    customers: empty ? [] : NAMES.map((name, i) => ({ name, email: `customer${i}@example.com` })),
    products: PRODUCTS.map((name, i) => ({ id: `prod_${i}`, name, storeId: "store_1" })),
    totalCount: empty ? 0 : 42,
    page: 1,
    pageSize: 25,
    search: "",
    status: "",
    dateFilter: "all",
    sortBy: "createdAt",
    sortDir: "desc",
    error: null,
    canUseEmailReminders: pro,
  };
}

// ----------------------------------------------------------------------- Medals

import { ACHIEVEMENT_DEFINITIONS, groupByFamily } from "../../app/services/achievements.shared";

/** Built from the REAL medal definitions, so this is the actual shipped set, not a mock-up. */
export function medalsLoaderData({ fresh = false } = {}) {
  const statuses = ACHIEVEMENT_DEFINITIONS.map((definition, index) => ({
    ...definition,
    // A fresh store has earned nothing; an established one has a realistic mix.
    unlocked: fresh ? false : index % 3 === 0,
    earnedAt: !fresh && index % 3 === 0 ? new Date(2026, 9, 10 + index).toISOString() : null,
    progress: fresh || index % 3 !== 0 ? { current: fresh ? 0 : index * 3, target: 50 } : null,
  }));

  const families = Array.from(groupByFamily(statuses).entries()).map(([family, familyStatuses]) => ({
    family,
    statuses: familyStatuses,
  }));

  return {
    families,
    earnedCount: statuses.filter((s) => s.unlocked).length,
    totalCount: statuses.length,
  };
}

// ---------------------------------------------------------------------- Billing

import { getAllPlans } from "../../app/services/billing/plans";

/** Real plan metadata — the prices and copy a merchant actually sees. */
export function billingLoaderData({ plan = "starter", trialing = false, devStore = false } = {}) {
  return {
    plans: getAllPlans(),
    snapshot: {
      storeId: "store_1",
      plan,
      planStatus: trialing ? "trialing" : plan === "starter" ? "active" : "active",
      isDevelopmentStore: devStore,
      isTrialing: trialing,
      trialEndsAt: trialing ? new Date(Date.now() + 9 * 86_400_000).toISOString() : null,
      hasAccess: devStore || plan !== "starter" || true,
    },
  };
}

// --------------------------------------------------------------------- Products

export function productsLoaderData({ empty = false, syncing = false, error = false } = {}) {
  const products = empty
    ? []
    : PRODUCTS.map((name, index) => ({
        id: `prod_${index}`,
        storeId: "store_1",
        shopifyProductId: `gid://shopify/Product/${900 + index}`,
        name,
        handle: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
        vendor: "Verve Outdoor",
        productType: index % 2 === 0 ? "Homeware" : "Apparel",
        status: index === 3 ? "DRAFT" : "ACTIVE",
        featuredImage: null,
        slug: null,
        description: null,
        averageRating: index === 2 ? 0 : 4.2 + index * 0.1,
        totalReviews: index === 2 ? 0 : 7 + index * 4,
        rating5Count: 10,
        rating4Count: 4,
        rating3Count: 2,
        rating2Count: 1,
        rating1Count: 0,
        createdAt: new Date("2026-09-01").toISOString(),
        updatedAt: new Date("2026-11-02").toISOString(),
      }));

  return {
    products,
    nextCursor: empty ? null : "prod_3",
    hasMore: !empty,
    totalCount: empty ? 0 : 12,
    search: "",
    syncState: syncing
      ? { status: "running", total: 12, synced: 5, failed: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null }
      : { status: "idle", total: 12, synced: 12, failed: 0, startedAt: null, finishedAt: new Date("2026-11-02").toISOString(), error: null },
    error: error ? "Shopify did not respond. Your products are unchanged." : null,
  };
}

// --------------------------------------------- Settings › Import, Product groups

import { IMPORT_SOURCES } from "../../app/services/importers/types";

/** Uses the real source list, so the "coming soon" gating on Ryviu is the shipped one. */
export function settingsImportLoaderData({ empty = false } = {}) {
  return {
    sources: IMPORT_SOURCES,
    batches: empty
      ? []
      : [
          {
            id: "b1",
            storeId: "store_1",
            source: "judgeme",
            filename: "judgeme-export-2026-11-01.csv",
            totalRows: 412,
            imported: 388,
            duplicates: 19,
            heldForModeration: 3,
            unmatchedRows: 2,
            invalidRows: 0,
            status: "completed",
            errorDetail: null,
            createdAt: new Date("2026-11-01").toISOString(),
            updatedAt: new Date("2026-11-01").toISOString(),
          },
          {
            id: "b2",
            storeId: "store_1",
            source: "loox",
            filename: "loox.csv",
            totalRows: 60,
            imported: 0,
            duplicates: 0,
            heldForModeration: 0,
            unmatchedRows: 60,
            invalidRows: 0,
            // The failure case is the one worth seeing rendered.
            status: "failed",
            errorDetail: { fileErrors: ["No products matched. Check the product handle column."], missingProducts: ["sku-1", "sku-2"] },
            createdAt: new Date("2026-11-03").toISOString(),
            updatedAt: new Date("2026-11-03").toISOString(),
          },
        ],
  };
}

// ---------------------------------------------------------------------------------------------
// The three screens that reach a merchant through a URL rather than a nav item, and so went
// unrendered until 2026-11-10 even after a sweep that claimed to cover every merchant screen:
// a product's own detail page, and the manual add/edit review forms.
// ---------------------------------------------------------------------------------------------

/** app.reviews_.new — the manual "add a review" form. Only needs the product picker's options. */
export function newReviewLoaderData() {
  return {
    products: PRODUCTS.map((name, index) => ({ id: `prod_${index}`, name })),
  };
}

/**
 * app.reviews_.$id.edit — editing an existing review.
 *
 * `found: false` is the more interesting of the two states and is why this takes a flag: the
 * route returns `review: null` with an error string for any id that is not this store's, which
 * is the tenant-isolation path a merchant hits by editing a URL.
 */
export function editReviewLoaderData({ found = true } = {}) {
  return {
    review: found ? review(1) : null,
    products: PRODUCTS.map((name, index) => ({ id: `prod_${index}`, name })),
    error: found ? null : "Review not found.",
  };
}

/** app.products_.$id — one product, its reviews and its AI summary. */
export function productDetailLoaderData({ found = true, reviews: withReviews = true } = {}) {
  if (!found) {
    return {
      product: null,
      reviews: [],
      reviewsTotalCount: 0,
      aiSummary: null,
      canUseAI: false,
      error: "Product not found.",
    };
  }

  const product = productsLoaderData().products[0];
  const reviews = withReviews ? Array.from({ length: 5 }, (_, index) => review(index)) : [];

  return {
    product,
    reviews,
    reviewsTotalCount: withReviews ? 31 : 0,
    // Every field of ProductAiSummaryRecord, including positives/negatives — the route reads
    // `.length` on both, so an incomplete summary object crashes the screen rather than
    // degrading. Written out in full for that reason.
    aiSummary: withReviews
      ? {
          id: "sum_1",
          productId: product.id,
          summary:
            "Shoppers consistently praise the build quality and the speed of delivery. The most " +
            "common criticism is sizing, which several reviewers describe as running small.",
          positives: ["Build quality", "Fast delivery", "Looks as pictured"],
          negatives: ["Sizing runs small"],
          recommendation: "Add a sizing note to the product description.",
          reviewCountUsed: 31,
          provider: "openai",
          modelUsed: "gpt-4o-mini",
          generatedAt: new Date("2026-11-08").toISOString(),
          updatedAt: new Date("2026-11-08").toISOString(),
        }
      : null,
    canUseAI: true,
    error: null,
  };
}

export function settingsProductGroupsLoaderData({ empty = false } = {}) {
  return {
    groups: empty
      ? []
      : [
          {
            id: "g1",
            name: "Ceramic plates",
            products: [
              { id: "prod_0", name: PRODUCTS[0], totalReviews: 31, averageRating: 4.6 },
              { id: "prod_3", name: PRODUCTS[3], totalReviews: 12, averageRating: 4.2 },
            ],
            createdAt: new Date("2026-10-10").toISOString(),
          },
        ],
    ungroupedProducts: PRODUCTS.slice(1, 3).map((name, i) => ({
      id: `prod_${i + 1}`,
      name,
      totalReviews: 7 + i,
      averageRating: 4.1,
    })),
  };
}
