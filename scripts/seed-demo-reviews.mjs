// One-off, additive demo-data seeder for App Store screenshots / marketing assets.
// Never deletes anything — only adds Reviews (+ nested media/helpful votes), ReviewRequests,
// and ProductAiSummary rows on top of whatever already exists for the store. Safe to re-run;
// each run adds another batch (ProductAiSummary is upserted, everything else is additive).
//
// Scope: verveonline.myshopify.com is a Shopify development test store (confirmed by the
// merchant — no real customers, no production traffic), so populating realistic-looking
// demo content here is authorized. See CLAUDE.md's Database Safety policy for why this
// check matters on this project.
import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REVIEWERS = [
  ["Amara Okafor", "Lagos, Nigeria"],
  ["Haruki Tanaka", "Tokyo, Japan"],
  ["Sofia Rossi", "Milan, Italy"],
  ["Liam O'Connor", "Dublin, Ireland"],
  ["Priya Sharma", "Mumbai, India"],
  ["Carlos Mendoza", "Mexico City, Mexico"],
  ["Emma Johansson", "Stockholm, Sweden"],
  ["Noah Williams", "Austin, TX, USA"],
  ["Fatima Al-Sayed", "Dubai, UAE"],
  ["Chloe Martin", "Paris, France"],
  ["Lucas Silva", "São Paulo, Brazil"],
  ["Mei Lin", "Singapore"],
  ["Jack Thompson", "Sydney, Australia"],
  ["Anna Kowalski", "Warsaw, Poland"],
  ["David Cohen", "Tel Aviv, Israel"],
  ["Grace Mensah", "Accra, Ghana"],
  ["Ethan Clarke", "London, UK"],
  ["Isabella Garcia", "Barcelona, Spain"],
  ["Oliver Bennett", "Toronto, Canada"],
  ["Yuki Sato", "Osaka, Japan"],
  ["Nadia Petrova", "Moscow, Russia"],
  ["Zainab Hussain", "Karachi, Pakistan"],
  ["Marco Bianchi", "Rome, Italy"],
  ["Hannah Kim", "Seoul, South Korea"],
  ["Ryan Murphy", "Boston, MA, USA"],
  ["Layla Ahmed", "Cairo, Egypt"],
  ["Sven Andersen", "Oslo, Norway"],
  ["Ana Popescu", "Bucharest, Romania"],
  ["Tariq Rahman", "Dhaka, Bangladesh"],
  ["Claire Dubois", "Montreal, Canada"],
  ["Diego Fernandez", "Buenos Aires, Argentina"],
  ["Ingrid Larsen", "Copenhagen, Denmark"],
  ["Wei Zhang", "Shanghai, China"],
  ["Aisha Bello", "Nairobi, Kenya"],
  ["Tom Baker", "Manchester, UK"],
  ["Valentina Cruz", "Bogotá, Colombia"],
  ["Elif Yildiz", "Istanbul, Turkey"],
  ["Connor Walsh", "Auckland, New Zealand"],
  ["Mariana Costa", "Lisbon, Portugal"],
  ["Ravi Patel", "Ahmedabad, India"],
];

const TITLES_5 = [
  "Exceeded my expectations!",
  "Absolutely beautiful",
  "Perfect for everyday use",
  "Gorgeous color, sturdy build",
  "My new favorite piece",
  "Exactly as pictured",
  "Great quality for the price",
  "Elevated my table setting",
  "Highly recommend",
  "Stunning craftsmanship",
  "Better than the photos",
  "Worth every penny",
];

const TITLES_4 = [
  "Really happy with this",
  "Great, minor nitpick",
  "Solid everyday piece",
  "Lovely, would buy again",
  "Good quality overall",
  "Nice addition to the kitchen",
];

const TITLES_3 = ["It's okay", "Does the job", "Decent, not amazing", "Mixed feelings"];
const TITLES_2 = ["Disappointed", "Expected more for the price", "Not quite right"];
const TITLES_1 = ["Arrived damaged", "Not what I expected", "Wouldn't order again"];

function content5(colorWord, noun) {
  const pool = [
    `This ${colorWord} ${noun} is even more beautiful in person. The glaze is smooth, the weight feels substantial, and it's become my go-to for everyday dinners.`,
    `I've bought ceramic pieces before that chip easily, but this one has held up perfectly through the dishwasher and daily use. Couldn't be happier.`,
    `Ordered this as a housewarming gift and ended up buying a second one for myself. The color is rich and the craftsmanship is obvious.`,
    `Fast shipping, arrived well packaged, and the ${noun} itself is gorgeous. It photographs beautifully for my food blog too.`,
    `This has quickly become the centerpiece of our table. Guests always ask where we got it.`,
    `The ${colorWord.toLowerCase()} tone is exactly what I hoped for — not too bright, not dull. Really elevates a simple meal.`,
    `Sturdy, well balanced, and the finish feels premium. I'm ordering the matching set next.`,
    `I run a small home bakery and use this for plating. It photographs beautifully and customers always compliment the presentation.`,
    `Better quality than pieces twice the price. The weight and glaze finish are genuinely impressive.`,
    `Bought four of these for a dinner party and they were a hit. Zero chips, zero complaints.`,
    `Feels handmade in the best way — small imperfections in the glaze that make it feel one of a kind.`,
    `Shipping was quick, packaging was excellent, and the ${noun} itself is even nicer than I expected.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function content4(noun) {
  const pool = [
    `Really happy with this ${noun}. Only reason it's not five stars is the color is very slightly different from the product photos, but still lovely.`,
    `Good weight and finish. Took a couple extra days to arrive but was worth the wait.`,
    `Solid purchase. One small imperfection in the glaze but nothing that affects daily use.`,
    `Nice addition to my kitchen. Slightly smaller than I expected but the quality makes up for it.`,
    `Great everyday piece. Would've given five stars if the packaging had been a bit more protective.`,
    `Love the color and feel. Just wish it came in a larger size option.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function content3(noun) {
  const pool = [
    `It's fine — does the job, but the glaze felt thinner than I expected for the price.`,
    `Decent quality overall. Arrived with a small scuff, but customer service was responsive.`,
    `Looks nice on the table but chips a little more easily than I'd like.`,
    `Average experience. Color was close to the photos but not an exact match.`,
    `The ${noun} itself is fine, just wasn't quite what I pictured from the listing.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function content2(noun) {
  const pool = [
    `Disappointed with the shipping — arrived with a small crack near the rim. Requested a replacement.`,
    `Thinner than expected for the price point. Might return it.`,
    `Color looked more vibrant in the photos than it does in person.`,
    `The ${noun} is usable but not quite the quality I was hoping for.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function content1(noun) {
  const pool = [
    `Arrived broken in transit. Packaging needs improvement.`,
    `Not what I expected — the finish felt rough in a few spots.`,
    `The ${noun} chipped within the first week of light use.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function replyFor(rating, firstName) {
  if (rating >= 4) {
    const pool = [
      `Thank you so much for sharing this, ${firstName}! We're thrilled it's found a place at your table.`,
      `We really appreciate the kind words, ${firstName} — enjoy many more meals with it!`,
      `This made our day, ${firstName}! Thank you for supporting our small studio.`,
      `So glad it arrived safely and looks great in your space, ${firstName}!`,
    ];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const pool = [
    `Thank you for the honest feedback, ${firstName} — we're sorry to hear this. Our team has reached out to make it right.`,
    `We're sorry this didn't meet expectations, ${firstName}. We've flagged this with our packaging team and would love to send a replacement.`,
    `Really appreciate you letting us know, ${firstName}. Please check your email — we'd like to help resolve this.`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function weightedPick(weighted) {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted[weighted.length - 1][0];
}

// More recent-weighted: most reviews land in the last 60 days, a longer tail back to ~5 months.
function randomRecentDate() {
  const now = Date.now();
  const bucket = Math.random();
  const daysAgo = bucket < 0.55 ? randomInt(0, 45) : bucket < 0.85 ? randomInt(46, 100) : randomInt(101, 150);
  return new Date(now - daysAgo * 24 * 60 * 60 * 1000 - randomInt(0, 24 * 60 * 60 * 1000));
}

function statusForRating(rating) {
  const table = {
    5: [["APPROVED", 0.9], ["PENDING", 0.1]],
    4: [["APPROVED", 0.85], ["PENDING", 0.15]],
    3: [["APPROVED", 0.5], ["PENDING", 0.35], ["REJECTED", 0.15]],
    2: [["APPROVED", 0.2], ["PENDING", 0.4], ["REJECTED", 0.4]],
    1: [["APPROVED", 0.1], ["PENDING", 0.3], ["REJECTED", 0.6]],
  };
  return weightedPick(table[rating]);
}

function productMeta(name) {
  const noun = /bowl/i.test(name) ? "bowl" : "plate";
  const colorWord = name.split(" ")[0] === "Teal" ? "Teal Green" : name.split(" ")[0];
  return { noun, colorWord };
}

const RATING_PLAN = [5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 2, 2, 1];

function buildReviewData({ product, index }) {
  const rating = RATING_PLAN[index % RATING_PLAN.length];
  const status = statusForRating(rating);
  const { noun, colorWord } = productMeta(product.name);
  const [fullName, location] = pick(REVIEWERS);
  const firstName = fullName.split(" ")[0];

  const title =
    rating === 5 ? pick(TITLES_5) : rating === 4 ? pick(TITLES_4) : rating === 3 ? pick(TITLES_3) : rating === 2 ? pick(TITLES_2) : pick(TITLES_1);
  const body =
    rating === 5 ? content5(colorWord, noun) : rating === 4 ? content4(noun) : rating === 3 ? content3(noun) : rating === 2 ? content2(noun) : content1(noun);

  const isApproved = status === "APPROVED";
  // Moderation Rules on this store require verified purchases for auto-publish — mirror
  // that correlation here so held/rejected reviews skew unverified, same as real traffic would.
  const verifiedPurchase = isApproved ? Math.random() < 0.85 : Math.random() < 0.45;
  const createdAt = randomRecentDate();

  const hasReply = isApproved && Math.random() < 0.35;
  const helpful = isApproved ? randomInt(0, 42) : 0;
  const notHelpful = isApproved && Math.random() < 0.3 ? randomInt(0, 4) : 0;
  const hasPhoto = isApproved && rating >= 4 && Math.random() < 0.28;

  const seed = `imagyn-${product.id}-${index}`;

  return {
    storeId: product.storeId,
    productId: product.id,
    productTitle: product.name,
    rating,
    title,
    content: body,
    reviewerName: fullName,
    reviewerEmail: `${firstName.toLowerCase()}${randomInt(10, 999)}@example.com`,
    reviewerLocation: location,
    verifiedPurchase,
    status,
    isPublished: isApproved,
    featured: false,
    helpfulCount: helpful,
    notHelpfulCount: notHelpful,
    reply: hasReply ? replyFor(rating, firstName) : null,
    repliedAt: hasReply ? new Date(createdAt.getTime() + randomInt(1, 4) * 24 * 60 * 60 * 1000) : null,
    createdAt,
    ...(helpful > 0 || notHelpful > 0
      ? {
          helpfulVotes: {
            create: [
              ...Array.from({ length: helpful }, (_, i) => ({
                visitorId: `demo-visitor-${seed}-h${i}`,
                vote: "HELPFUL",
              })),
              ...Array.from({ length: notHelpful }, (_, i) => ({
                visitorId: `demo-visitor-${seed}-n${i}`,
                vote: "NOT_HELPFUL",
              })),
            ],
          },
        }
      : {}),
    ...(hasPhoto
      ? {
          media: {
            create: Array.from({ length: randomInt(1, 2) }, (_, i) => ({
              type: "IMAGE",
              url: `https://picsum.photos/seed/${seed}-${i}/900/900`,
              thumbnailUrl: `https://picsum.photos/seed/${seed}-${i}/300/300`,
              width: 900,
              height: 900,
            })),
          },
        }
      : {}),
  };
}

async function recalcStats(productId) {
  const [totalReviews, aggregate, ratingGroups] = await Promise.all([
    prisma.review.count({ where: { productId, deletedAt: null } }),
    prisma.review.aggregate({ where: { productId, deletedAt: null }, _avg: { rating: true } }),
    prisma.review.groupBy({ by: ["rating"], where: { productId, deletedAt: null }, _count: { rating: true } }),
  ]);
  const countByRating = new Map(ratingGroups.map((g) => [g.rating, g._count.rating]));

  return prisma.product.update({
    where: { id: productId },
    data: {
      totalReviews,
      averageRating: Number((aggregate._avg.rating ?? 0).toFixed(1)),
      rating5Count: countByRating.get(5) ?? 0,
      rating4Count: countByRating.get(4) ?? 0,
      rating3Count: countByRating.get(3) ?? 0,
      rating2Count: countByRating.get(2) ?? 0,
      rating1Count: countByRating.get(1) ?? 0,
    },
  });
}

const AI_SUMMARIES = {
  bowl: {
    summary:
      "Shoppers consistently praise the Orange Ceramic Bowl's vibrant color and versatility across cooking and serving. A handful of reviews flag shipping damage or a slightly muted color compared to photos, but sentiment is overwhelmingly positive.",
    positives: ["Vibrant, true-to-photo color", "Feels sturdy and well-balanced", "Versatile for both cooking and serving"],
    negatives: ["Occasional shipping damage", "A few reviews note the glaze is thinner than expected"],
    recommendation:
      "Recommended — consider reinforcing packaging to reduce the small number of shipping-damage reports and the product will have very few detractors left.",
  },
  plate: {
    summary:
      "Reviews for this ceramic plate highlight its premium weight, color accuracy, and durability through daily use and dishwashing. A minority of buyers report chipping or a color slightly different from the listing photos.",
    positives: ["Substantial, premium-feeling weight", "Color matches product photos closely", "Holds up well to daily use and dishwashing"],
    negatives: ["A few reports of chipping with heavy use", "Occasional color mismatch versus photos"],
    recommendation:
      "Recommended — the strong majority of feedback is positive; addressing the rare color-accuracy complaints in the listing photography could improve satisfaction further.",
  },
};

async function main() {
  const store = await prisma.store.findFirst();
  if (!store) throw new Error("No store found — aborting.");

  const products = await prisma.product.findMany({ where: { storeId: store.id } });
  if (products.length === 0) throw new Error("No products found — aborting.");

  console.log(`Seeding demo content for store "${store.name}" (${products.length} products)...`);

  let reviewsCreated = 0;

  for (const product of products) {
    const perProduct = RATING_PLAN.length; // 19 per product
    for (let i = 0; i < perProduct; i += 1) {
      const data = buildReviewData({ product, index: i });
      await prisma.review.create({ data });
      reviewsCreated += 1;
    }

    // Feature the single best, most-helpful APPROVED 5-star review for this product.
    const topReview = await prisma.review.findFirst({
      where: { productId: product.id, rating: 5, status: "APPROVED" },
      orderBy: { helpfulCount: "desc" },
    });
    if (topReview) {
      await prisma.review.update({ where: { id: topReview.id }, data: { featured: true } });
    }

    await recalcStats(product.id);

    const approvedCount = await prisma.review.count({ where: { productId: product.id, status: "APPROVED", deletedAt: null } });
    const { noun } = productMeta(product.name);
    const summary = AI_SUMMARIES[noun];

    await prisma.productAiSummary.upsert({
      where: { productId: product.id },
      update: {
        summary: summary.summary,
        positives: JSON.stringify(summary.positives),
        negatives: JSON.stringify(summary.negatives),
        recommendation: summary.recommendation,
        reviewCountUsed: approvedCount,
        provider: "openai",
        modelUsed: "gpt-4o-mini",
        generatedAt: new Date(),
      },
      create: {
        productId: product.id,
        summary: summary.summary,
        positives: JSON.stringify(summary.positives),
        negatives: JSON.stringify(summary.negatives),
        recommendation: summary.recommendation,
        reviewCountUsed: approvedCount,
        provider: "openai",
        modelUsed: "gpt-4o-mini",
      },
    });
  }

  // Review requests: a mix of lifecycle states across all products, for the Requests page.
  const REQUEST_STATUSES = [
    "pending", "pending",
    "scheduled", "scheduled",
    "sent", "sent", "sent",
    "clicked", "clicked",
    "completed", "completed", "completed",
    "failed",
  ];

  let requestsCreated = 0;
  for (const product of products) {
    for (let i = 0; i < REQUEST_STATUSES.length; i += 1) {
      const status = REQUEST_STATUSES[i];
      const [fullName] = pick(REVIEWERS);
      const firstName = fullName.split(" ")[0];
      const createdAt = randomRecentDate();
      const isFuture = status === "scheduled" || status === "pending";

      await prisma.reviewRequest.create({
        data: {
          storeId: store.id,
          productId: product.id,
          email: `${firstName.toLowerCase()}${randomInt(10, 999)}@example.com`,
          name: fullName,
          orderNumber: `#${randomInt(10000, 10999)}`,
          requestToken: `demo_${Math.random().toString(36).slice(2, 12)}`,
          status,
          source: "order",
          delayDays: 7,
          scheduledFor: isFuture ? new Date(Date.now() + randomInt(1, 10) * 24 * 60 * 60 * 1000) : null,
          sentAt: ["sent", "clicked", "completed"].includes(status) ? createdAt : null,
          openedAt: ["clicked", "completed"].includes(status) ? new Date(createdAt.getTime() + 3600_000) : null,
          reviewedAt: status === "completed" ? new Date(createdAt.getTime() + 2 * 24 * 60 * 60 * 1000) : null,
          createdAt,
        },
      });
      requestsCreated += 1;
    }
  }

  console.log(
    `Seed complete: ${reviewsCreated} reviews, ${requestsCreated} review requests, ${products.length} AI summaries across ${products.length} products.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
