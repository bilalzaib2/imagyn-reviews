// Imagyn Reviews — Google Shopping Product Ratings & Reviews feed
// (https://support.google.com/merchants/answer/7050082). Generates a real, spec-compliant
// XML feed from this store's actual approved reviews and synced products — no fabricated
// content. What this file deliberately does NOT do: authenticate with Google, register the
// feed with Merchant Center, or submit anything. That's a real external account/OAuth step
// only the merchant can complete (see docs/DECISIONS.md) — this feed is designed to be
// fetched by Google on a schedule once a merchant registers this URL themselves, which is
// one of Google's own two supported submission methods (the other being their Content API,
// not implemented here).

import crypto from "node:crypto";
import prisma from "../db.server";

export interface FeedReadiness {
  feedEnabled: boolean;
  feedUrl: string | null;
  // Same enable flag and token as feedUrl — this is one merchant decision ("make my published
  // reviews publicly fetchable"), exposed in two output formats rather than a second toggle.
  // Google Merchant Center needs the XML shape above; any other distribution channel (ad
  // network, affiliate feed, a merchant's own script) is far more likely to want plain JSON —
  // see generateDistributionFeedJson below.
  distributionFeedUrl: string | null;
  hasStoreDomain: boolean;
  eligibleReviewCount: number;
  excludedReviewCount: number;
  excludedReasons: { noProductHandle: number; missingContent: number };
}

function appBaseUrl(): string {
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000";
  return appUrl.replace(/\/$/, "");
}

function buildFeedUrl(token: string): string {
  return `${appBaseUrl()}/feeds/google-reviews/${token}`;
}

function buildDistributionFeedUrl(token: string): string {
  return `${appBaseUrl()}/feeds/reviews-json/${token}`;
}

async function ensureFeedToken(storeId: string): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { googleFeedToken: true } });
  if (store.googleFeedToken) {
    return store.googleFeedToken;
  }

  const token = crypto.randomBytes(24).toString("hex");
  await prisma.store.update({ where: { id: storeId }, data: { googleFeedToken: token } });
  return token;
}

export async function setGoogleFeedEnabled(
  storeId: string,
  enabled: boolean,
): Promise<{ feedUrl: string | null; distributionFeedUrl: string | null }> {
  if (!enabled) {
    await prisma.store.update({ where: { id: storeId }, data: { googleFeedEnabled: false } });
    return { feedUrl: null, distributionFeedUrl: null };
  }

  const token = await ensureFeedToken(storeId);
  await prisma.store.update({ where: { id: storeId }, data: { googleFeedEnabled: true } });
  return { feedUrl: buildFeedUrl(token), distributionFeedUrl: buildDistributionFeedUrl(token) };
}

// A product qualifies for the feed if it has a real, resolvable storefront URL
// (store.domain + product.handle) — Google's spec accepts product_url as a valid identifier
// on its own, no GTIN/MPN required. A review qualifies if its product qualifies and it has
// real, non-empty review content.
export async function getFeedReadiness(storeId: string): Promise<FeedReadiness> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { domain: true, googleFeedEnabled: true, googleFeedToken: true },
  });

  const reviews = await prisma.review.findMany({
    where: { storeId, deletedAt: null, isPublished: true },
    select: { content: true, product: { select: { handle: true } } },
  });

  let eligible = 0;
  let noProductHandle = 0;
  let missingContent = 0;

  for (const review of reviews) {
    const hasContent = review.content.trim().length > 0;
    const hasProductUrl = Boolean(store.domain && review.product.handle);

    if (!hasProductUrl) {
      noProductHandle += 1;
      continue;
    }
    if (!hasContent) {
      missingContent += 1;
      continue;
    }
    eligible += 1;
  }

  const feedUrl = store.googleFeedEnabled && store.googleFeedToken ? buildFeedUrl(store.googleFeedToken) : null;
  const distributionFeedUrl =
    store.googleFeedEnabled && store.googleFeedToken ? buildDistributionFeedUrl(store.googleFeedToken) : null;

  return {
    feedEnabled: store.googleFeedEnabled,
    feedUrl,
    distributionFeedUrl,
    hasStoreDomain: Boolean(store.domain),
    eligibleReviewCount: eligible,
    excludedReviewCount: noProductHandle + missingContent,
    excludedReasons: { noProductHandle, missingContent },
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function findStoreByFeedToken(token: string) {
  return prisma.store.findFirst({ where: { googleFeedToken: token, googleFeedEnabled: true }, select: { id: true, domain: true, name: true } });
}

// Builds the real feed XML — only ever called for a store that's confirmed enabled (see
// findStoreByFeedToken above). Excludes exactly the same rows getFeedReadiness would flag as
// ineligible, so the merchant-facing readiness count and the actual feed content can never
// disagree.
export async function generateFeedXml(storeId: string, storeDomain: string): Promise<string> {
  const reviews = await prisma.review.findMany({
    where: { storeId, deletedAt: null, isPublished: true },
    select: {
      id: true,
      rating: true,
      title: true,
      content: true,
      reviewerName: true,
      createdAt: true,
      product: { select: { name: true, handle: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const entries = reviews
    .filter((review) => review.product.handle && review.content.trim().length > 0)
    .map((review) => {
      const productUrl = `https://${storeDomain}/products/${review.product.handle}`;
      return `  <review>
    <review_id>${xmlEscape(review.id)}</review_id>
    <reviewer>
      <name>${xmlEscape(review.reviewerName)}</name>
    </reviewer>
    <review_timestamp>${review.createdAt.toISOString()}</review_timestamp>
    ${review.title ? `<title>${xmlEscape(review.title)}</title>` : ""}
    <content>${xmlEscape(review.content)}</content>
    <ratings>
      <overall min="1" max="5">${review.rating}</overall>
    </ratings>
    <products>
      <product>
        <product_ids>
          <product_urls>
            <product_url>${xmlEscape(productUrl)}</product_url>
          </product_urls>
        </product_ids>
        <product_name>${xmlEscape(review.product.name)}</product_name>
      </product>
    </products>
  </review>`;
    });

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed>
<reviews>
${entries.join("\n")}
</reviews>
</feed>
`;
}

export interface DistributionFeedReview {
  id: string;
  rating: number;
  title: string | null;
  content: string;
  reviewerName: string;
  verifiedPurchase: boolean;
  createdAt: string;
  product: { name: string; url: string };
}

// A plain-JSON counterpart to generateFeedXml — same eligibility rule (real product URL, real
// content), same store-scoping, same public unauthenticated token gate, just a shape any
// channel that isn't Google Merchant Center specifically (an ad network, an affiliate feed, a
// merchant's own script) can consume without parsing Google's XML review-feed schema. Not a
// second data source: this and the XML feed are two views of the exact same underlying
// eligible-review set, so getFeedReadiness's counts describe both.
export async function generateDistributionFeedJson(storeId: string, storeDomain: string): Promise<string> {
  const reviews = await prisma.review.findMany({
    where: { storeId, deletedAt: null, isPublished: true },
    select: {
      id: true,
      rating: true,
      title: true,
      content: true,
      reviewerName: true,
      verifiedPurchase: true,
      createdAt: true,
      product: { select: { name: true, handle: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const eligible: DistributionFeedReview[] = reviews
    .filter((review) => review.product.handle && review.content.trim().length > 0)
    .map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      content: review.content,
      reviewerName: review.reviewerName,
      verifiedPurchase: review.verifiedPurchase,
      createdAt: review.createdAt.toISOString(),
      product: { name: review.product.name, url: `https://${storeDomain}/products/${review.product.handle}` },
    }));

  return JSON.stringify({ store: storeDomain, generatedAt: new Date().toISOString(), reviews: eligible }, null, 2);
}
