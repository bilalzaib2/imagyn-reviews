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
