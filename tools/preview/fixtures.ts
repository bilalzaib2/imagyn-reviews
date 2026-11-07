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
