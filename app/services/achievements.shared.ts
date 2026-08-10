// Imagyn Reviews — Medals/Achievements definitions.
//
// Pure, client-safe metadata (no Prisma import) — same .shared.ts/.server.ts split
// convention as email.shared.ts/appearance.shared.ts. The actual earning logic lives in
// achievements.server.ts; this file only describes what each medal is and how it behaves.
//
// Original Imagyn concept, not a Judge.me copy: names, copy, and the medallion artwork
// (components/medals/Medallion.tsx) are all original to this app.

export type AchievementCategory = "verified" | "milestone" | "trust" | "ranking" | "trending";

export interface AchievementDefinition {
  /** Stable, unique identifier — persisted as Achievement.key. Never rename in place; retire
   *  and add a new key instead, since a persisted row's key is permanent history. */
  key: string;
  /** Groups tiers of the same concept together in the UI (e.g. all four Verified Voices
   *  tiers share family "verified_voices"). */
  family: string;
  /** Where this tier sits within its family, ascending — drives "next tier" progress copy. */
  tier: number;
  name: string;
  /** What was actually measured — shown on both locked and unlocked cards. */
  description: string;
  category: AchievementCategory;
  /** true = a permanent milestone (an Achievement row is written once earned and never
   *  removed, even if the underlying metric later dips). false = a live, current-status
   *  medal that's recomputed on every read and never persisted — see Trending below for why
   *  that distinction matters. */
  persistent: boolean;
  /** No medal is Pro-gated in this initial set (Free merchants earn/display all of them, per
   *  product direction) — this field exists so a genuine Pro-only medal can be added later
   *  without changing the shape every call site already reads. */
  isPro: boolean;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // 1. Verified Reviews milestone — count of verified-purchase, approved reviews.
  {
    key: "verified_reviews_10",
    family: "verified_voices",
    tier: 1,
    name: "Foundations",
    description: "10 verified-purchase reviews collected.",
    category: "verified",
    persistent: true,
    isPro: false,
  },
  {
    key: "verified_reviews_50",
    family: "verified_voices",
    tier: 2,
    name: "Momentum",
    description: "50 verified-purchase reviews collected.",
    category: "verified",
    persistent: true,
    isPro: false,
  },
  {
    key: "verified_reviews_100",
    family: "verified_voices",
    tier: 3,
    name: "Century",
    description: "100 verified-purchase reviews collected.",
    category: "verified",
    persistent: true,
    isPro: false,
  },
  {
    key: "verified_reviews_500",
    family: "verified_voices",
    tier: 4,
    name: "Landmark",
    description: "500 verified-purchase reviews collected.",
    category: "verified",
    persistent: true,
    isPro: false,
  },

  // 2. Monthly Record — the store's best calendar month by approved-review volume.
  {
    key: "monthly_record",
    family: "peak_month",
    tier: 1,
    name: "Peak Month",
    description: "Your best calendar month yet for approved reviews.",
    category: "milestone",
    persistent: true,
    isPro: false,
  },

  // 3. Authenticity / Trust — share of approved reviews that are verified purchases.
  {
    key: "trust_verified_80",
    family: "trust",
    tier: 1,
    name: "Trusted",
    description: "80%+ of your approved reviews are verified purchases.",
    category: "trust",
    persistent: true,
    isPro: false,
  },
  {
    key: "trust_verified_95",
    family: "trust",
    tier: 2,
    name: "Highly Trusted",
    description: "95%+ of your approved reviews are verified purchases.",
    category: "trust",
    persistent: true,
    isPro: false,
  },

  // 4. Top Stores — percentile rank by approved-review volume, platform-wide. Computed from
  // aggregate counts only — see achievements.server.ts's own comment on why no other store's
  // identity or data is ever read to determine this.
  {
    key: "top_stores_25",
    family: "top_stores",
    tier: 1,
    name: "Rising Tier",
    description: "Top 25% of stores on Imagyn Reviews by approved-review volume.",
    category: "ranking",
    persistent: true,
    isPro: false,
  },
  {
    key: "top_stores_10",
    family: "top_stores",
    tier: 2,
    name: "Leading Tier",
    description: "Top 10% of stores on Imagyn Reviews by approved-review volume.",
    category: "ranking",
    persistent: true,
    isPro: false,
  },

  // 5. Trending — month-over-month growth. Deliberately non-persistent: this describes
  // current momentum, not a permanent accomplishment, so it's recomputed live every time and
  // never written to the Achievement ledger.
  {
    key: "trending_up",
    family: "trending",
    tier: 1,
    name: "Trending",
    description: "Approved reviews are up at least 25% over last month.",
    category: "trending",
    persistent: false,
    isPro: false,
  },
];

export interface AchievementProgress {
  current: number;
  target: number;
}

export interface AchievementStatus extends AchievementDefinition {
  unlocked: boolean;
  /** ISO date string. Null when locked, or when a non-persistent medal isn't currently active. */
  earnedAt: string | null;
  /** Null when there's nothing meaningful to show a bar for (e.g. an unlocked medal, or
   *  Trending's boolean current-state). */
  progress: AchievementProgress | null;
}

export function groupByFamily(statuses: AchievementStatus[]): Map<string, AchievementStatus[]> {
  const groups = new Map<string, AchievementStatus[]>();
  for (const status of statuses) {
    const existing = groups.get(status.family);
    if (existing) {
      existing.push(status);
    } else {
      groups.set(status.family, [status]);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.tier - b.tier);
  }
  return groups;
}
