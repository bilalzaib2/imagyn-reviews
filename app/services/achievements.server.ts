// Imagyn Reviews — Medals/Achievements evaluation engine.
//
// evaluateAchievements(storeId) is the one entry point every caller uses. Everything here is
// scoped by the caller's own storeId, resolved server-side from the authenticated session
// (see app.medals.tsx) — no route or function in this file accepts a client-supplied storeId,
// and nothing here is reachable with attacker-controlled input that could fabricate a medal.
// A persistent medal, once written to the Achievement table, is read back rather than
// recomputed — its earnedAt never changes, and it's never un-earned if the underlying metric
// later dips (the achievement genuinely happened at that point in time).
import prisma from "../db.server";
import { ReviewStatus } from "./review.shared";
import { ACHIEVEMENT_DEFINITIONS, type AchievementDefinition, type AchievementStatus } from "./achievements.shared";

const MIN_APPROVED_FOR_TRUST = 20;
const MIN_APPROVED_FOR_PEAK_MONTH = 5;
const MIN_STORES_FOR_RANKING = 5;
const TRENDING_MIN_GROWTH_RATIO = 1.25;
const TRENDING_MIN_ABSOLUTE_INCREASE = 3;

const VERIFIED_VOICES_TARGETS: Record<string, number> = {
  verified_reviews_10: 10,
  verified_reviews_50: 50,
  verified_reviews_100: 100,
  verified_reviews_500: 500,
};

const TRUST_TARGETS: Record<string, number> = {
  trust_verified_80: 80,
  trust_verified_95: 95,
};

const RANKING_TARGETS: Record<string, number> = {
  top_stores_25: 25,
  top_stores_10: 10,
};

function definitionsByFamily(family: string): AchievementDefinition[] {
  return ACHIEVEMENT_DEFINITIONS.filter((definition) => definition.family === family).sort((a, b) => a.tier - b.tier);
}

// UTC-consistent month bucketing — the earlier Analytics timezone bug (local-time range start
// vs UTC-keyed buckets producing an off-by-one-day mismatch) is exactly the class of mistake
// this avoids: every date here is truncated/compared in UTC, never local time.
function monthKeyUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStartUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonthsUTC(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

async function getExistingAchievements(storeId: string): Promise<Map<string, { earnedAt: Date }>> {
  const rows = await prisma.achievement.findMany({ where: { storeId }, select: { key: true, earnedAt: true } });
  return new Map(rows.map((row) => [row.key, { earnedAt: row.earnedAt }]));
}

async function persistIfNewlyEarned(
  storeId: string,
  key: string,
  earnedAt: Date,
  metadata: Record<string, unknown>,
  existing: Map<string, { earnedAt: Date }>,
): Promise<Date> {
  const already = existing.get(key);
  if (already) {
    return already.earnedAt;
  }

  await prisma.achievement.create({
    data: { storeId, key, earnedAt, metadata: JSON.stringify(metadata) },
  });

  return earnedAt;
}

// Family 1: Verified Voices — verified-purchase, approved reviews. earnedAt for each tier is
// the real createdAt of the review that actually crossed that tier's threshold, not "now" —
// derivable exactly because review rows carry their own creation date.
async function evaluateVerifiedVoices(
  storeId: string,
  existing: Map<string, { earnedAt: Date }>,
): Promise<AchievementStatus[]> {
  const definitions = definitionsByFamily("verified_voices");

  const verifiedApprovedCount = await prisma.review.count({
    where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED, verifiedPurchase: true },
  });

  const results: AchievementStatus[] = [];

  for (const definition of definitions) {
    const target = VERIFIED_VOICES_TARGETS[definition.key];
    const unlocked = verifiedApprovedCount >= target;

    let earnedAt: Date | null = null;
    if (unlocked) {
      if (existing.has(definition.key)) {
        earnedAt = existing.get(definition.key)!.earnedAt;
      } else {
        const nthReview = await prisma.review.findFirst({
          where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED, verifiedPurchase: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          skip: target - 1,
          select: { createdAt: true },
        });
        earnedAt = await persistIfNewlyEarned(
          storeId,
          definition.key,
          nthReview?.createdAt ?? new Date(),
          { count: verifiedApprovedCount, target },
          existing,
        );
      }
    }

    results.push({
      ...definition,
      unlocked,
      earnedAt: earnedAt ? earnedAt.toISOString() : null,
      progress: unlocked ? null : { current: verifiedApprovedCount, target },
    });
  }

  return results;
}

// Family 2: Peak Month — the store's best calendar month by approved-review volume. earnedAt
// is the real start-of-month date of that best month, not "now" — this is the one family
// where an exact historical date is directly derivable from the data with no ambiguity.
async function evaluatePeakMonth(
  storeId: string,
  existing: Map<string, { earnedAt: Date }>,
): Promise<AchievementStatus[]> {
  const [definition] = definitionsByFamily("peak_month");

  const reviews = await prisma.review.findMany({
    where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED },
    select: { createdAt: true },
  });

  const countByMonth = new Map<string, { count: number; monthStart: Date }>();
  for (const review of reviews) {
    const key = monthKeyUTC(review.createdAt);
    const bucket = countByMonth.get(key);
    if (bucket) {
      bucket.count += 1;
    } else {
      countByMonth.set(key, { count: 1, monthStart: monthStartUTC(review.createdAt) });
    }
  }

  let best: { count: number; monthStart: Date } | null = null;
  for (const bucket of countByMonth.values()) {
    if (!best || bucket.count > best.count) {
      best = bucket;
    }
  }

  const unlocked = !!best && best.count >= MIN_APPROVED_FOR_PEAK_MONTH;

  let earnedAt: Date | null = null;
  if (unlocked && best) {
    if (existing.has(definition.key)) {
      earnedAt = existing.get(definition.key)!.earnedAt;
    } else {
      earnedAt = await persistIfNewlyEarned(
        storeId,
        definition.key,
        best.monthStart,
        { count: best.count, month: monthKeyUTC(best.monthStart) },
        existing,
      );
    }
  }

  return [
    {
      ...definition,
      unlocked,
      earnedAt: earnedAt ? earnedAt.toISOString() : null,
      progress: unlocked ? null : { current: best?.count ?? 0, target: MIN_APPROVED_FOR_PEAK_MONTH },
    },
  ];
}

// Family 3: Trust — share of approved reviews that are verified purchases, gated by a minimum
// sample size so a store with 2 reviews (both verified) can't trivially show "100% trusted."
// There's no single exact historical date a percentage "crossed" a threshold without
// expensive historical replay, so earnedAt here is honestly the first-detected date (the day
// this was first evaluated as true) — documented, not presented as a precise crossing date.
async function evaluateTrust(storeId: string, existing: Map<string, { earnedAt: Date }>): Promise<AchievementStatus[]> {
  const definitions = definitionsByFamily("trust");

  const [approvedCount, verifiedApprovedCount] = await Promise.all([
    prisma.review.count({ where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED } }),
    prisma.review.count({ where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED, verifiedPurchase: true } }),
  ]);

  const hasSample = approvedCount >= MIN_APPROVED_FOR_TRUST;
  const verifiedRate = approvedCount > 0 ? Math.round((verifiedApprovedCount / approvedCount) * 100) : 0;

  const results: AchievementStatus[] = [];

  for (const definition of definitions) {
    const target = TRUST_TARGETS[definition.key];
    const unlocked = hasSample && verifiedRate >= target;

    let earnedAt: Date | null = null;
    if (unlocked) {
      earnedAt = existing.has(definition.key)
        ? existing.get(definition.key)!.earnedAt
        : await persistIfNewlyEarned(
            storeId,
            definition.key,
            new Date(),
            { verifiedRate, approvedCount, target },
            existing,
          );
    }

    results.push({
      ...definition,
      unlocked,
      earnedAt: earnedAt ? earnedAt.toISOString() : null,
      progress: unlocked ? null : { current: hasSample ? verifiedRate : approvedCount, target: hasSample ? target : MIN_APPROVED_FOR_TRUST },
    });
  }

  return results;
}

// Family 4: Top Stores — percentile rank by approved-review volume, platform-wide. Uses
// aggregate counts ONLY: the groupBy+having query below returns other stores' ids (Prisma
// requires grouping by the id to filter on a per-group count), but this function only ever
// reads `.length` off that result — no other store's id, name, or any other data is read from
// it or returned from this function. Guarded by MIN_STORES_FOR_RANKING so a near-empty
// platform never produces a meaningless "top 1% of 2 stores" medal.
async function evaluateTopStores(
  storeId: string,
  existing: Map<string, { earnedAt: Date }>,
): Promise<AchievementStatus[]> {
  const definitions = definitionsByFamily("top_stores");

  const [myApprovedCount, totalStores] = await Promise.all([
    prisma.review.count({ where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED } }),
    prisma.store.count(),
  ]);

  const hasEnoughStores = totalStores >= MIN_STORES_FOR_RANKING;

  let percentile = 0;
  if (hasEnoughStores) {
    const higherStores = await prisma.review.groupBy({
      by: ["storeId"],
      where: { deletedAt: null, status: ReviewStatus.APPROVED },
      _count: { id: true },
      having: { id: { _count: { gt: myApprovedCount } } },
    });
    const storesAtOrBelow = totalStores - higherStores.length;
    percentile = Math.round((storesAtOrBelow / totalStores) * 100);
  }

  const results: AchievementStatus[] = [];

  for (const definition of definitions) {
    const topPercentTarget = RANKING_TARGETS[definition.key];
    // percentile is "at or below this rank" (higher = better) — top 10% means percentile >= 90.
    const unlocked = hasEnoughStores && percentile >= 100 - topPercentTarget;

    let earnedAt: Date | null = null;
    if (unlocked) {
      earnedAt = existing.has(definition.key)
        ? existing.get(definition.key)!.earnedAt
        : await persistIfNewlyEarned(
            storeId,
            definition.key,
            new Date(),
            { percentile, storesConsidered: totalStores },
            existing,
          );
    }

    results.push({
      ...definition,
      unlocked,
      earnedAt: earnedAt ? earnedAt.toISOString() : null,
      progress: unlocked || !hasEnoughStores ? null : { current: percentile, target: 100 - topPercentTarget },
    });
  }

  return results;
}

// Family 5: Trending — month-over-month growth in approved reviews. Deliberately not
// persisted (see achievements.shared.ts's comment on the definition) — always live, so
// earnedAt is either "now" while currently trending, or null.
async function evaluateTrending(storeId: string): Promise<AchievementStatus[]> {
  const [definition] = definitionsByFamily("trending");

  const now = new Date();
  const currentMonthStart = monthStartUTC(now);
  const previousMonthStart = addMonthsUTC(currentMonthStart, -1);

  const [currentCount, previousCount] = await Promise.all([
    prisma.review.count({
      where: { storeId, deletedAt: null, status: ReviewStatus.APPROVED, createdAt: { gte: currentMonthStart } },
    }),
    prisma.review.count({
      where: {
        storeId,
        deletedAt: null,
        status: ReviewStatus.APPROVED,
        createdAt: { gte: previousMonthStart, lt: currentMonthStart },
      },
    }),
  ]);

  const increase = currentCount - previousCount;
  const unlocked =
    previousCount > 0
      ? currentCount >= previousCount * TRENDING_MIN_GROWTH_RATIO && increase >= TRENDING_MIN_ABSOLUTE_INCREASE
      : currentCount >= TRENDING_MIN_ABSOLUTE_INCREASE;

  return [
    {
      ...definition,
      unlocked,
      earnedAt: unlocked ? now.toISOString() : null,
      progress: null,
    },
  ];
}

export async function evaluateAchievements(storeId: string): Promise<AchievementStatus[]> {
  const existing = await getExistingAchievements(storeId);

  const [verifiedVoices, peakMonth, trust, topStores, trending] = await Promise.all([
    evaluateVerifiedVoices(storeId, existing),
    evaluatePeakMonth(storeId, existing),
    evaluateTrust(storeId, existing),
    evaluateTopStores(storeId, existing),
    evaluateTrending(storeId),
  ]);

  return [...verifiedVoices, ...peakMonth, ...trust, ...topStores, ...trending];
}

export interface StorefrontMedal {
  key: string;
  name: string;
  description: string;
  category: AchievementDefinition["category"];
  earnedAt: string;
}

// Public-storefront read path (see api.reviews.tsx) — deliberately NOT evaluateAchievements.
// That function runs a real, multi-query computation per family (including a platform-wide
// aggregate for Top Stores) meant for an authenticated merchant's occasional admin-page visit,
// not for every anonymous storefront page view. This instead only reads the already-persisted
// Achievement ledger — one indexed query, storeId-scoped — so a medal appears on the
// storefront once it's been detected on a merchant's next /app/medals visit, not live on every
// shopper's page load. Only persistent (ledger-backed) medals can appear here; Trending has no
// ledger row by design (see achievements.shared.ts) and is therefore admin-only for now.
// Returns only the highest-earned tier per family — a shopper doesn't need to see every
// intermediate milestone a store has ever crossed, just its current standing — and only the
// display-safe fields a storefront visitor should ever see (no metadata, no counts, no
// percentiles, no other store's data of any kind).
export async function getEarnedMedalsForStorefront(storeId: string): Promise<StorefrontMedal[]> {
  const rows = await prisma.achievement.findMany({
    where: { storeId },
    select: { key: true, earnedAt: true },
  });

  const definitionByKey = new Map(ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.key, definition]));

  const highestByFamily = new Map<string, { definition: AchievementDefinition; earnedAt: Date }>();
  for (const row of rows) {
    const definition = definitionByKey.get(row.key);
    // Skips silently rather than throwing — a retired/unknown key (see the Achievement.key
    // comment in schema.prisma) must never break a real merchant's storefront.
    if (!definition) continue;

    const current = highestByFamily.get(definition.family);
    if (!current || definition.tier > current.definition.tier) {
      highestByFamily.set(definition.family, { definition, earnedAt: row.earnedAt });
    }
  }

  return Array.from(highestByFamily.values())
    .sort((a, b) => b.earnedAt.getTime() - a.earnedAt.getTime())
    .map(({ definition, earnedAt }) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      earnedAt: earnedAt.toISOString(),
    }));
}
