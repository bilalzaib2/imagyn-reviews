import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";

import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { LinkButton } from "../components/ui/LinkButton";
import { PageHeader } from "../components/ui/PageHeader";
import { Banner } from "../components/ui/Banner";
import { EmptyState } from "../components/ui/EmptyState";
import { StatusBadge } from "../components/ui/StatusBadge";
import { AppReviewPrompt } from "../components/ui/AppReviewPrompt";
import { StarRating } from "../components/reviews/StarRating";
import { PillarStatusIcon } from "../components/ui/PillarStatusIcon";
import { getStoreReviewStats } from "../services/review.server";
import { reviewRequestService } from "../services/review-request.server";
import { getLatestAiSummaryForStore } from "../services/aiSummary.server";
import { getProductReviewCoverage } from "../services/product.server";
import { getRewardStats } from "../services/rewards.server";
import { getSetupGuideItems } from "../services/setupGuide.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrRefreshTrustCertification, refreshTrustCertification } from "../services/trustCertification.server";
import {
  OVERALL_STATUS_LABEL,
  OVERALL_STATUS_SUMMARY,
  OVERALL_STATUS_TONE,
  PILLAR_STATUS_LABEL,
  PILLAR_STATUS_TONE,
  MIN_VERIFIED_REVIEWS,
  REVIEW_PRACTICES_THRESHOLD,
  buildPillarViews,
} from "../services/trustCertification.presentation";
import { ORDER_AUTOMATION_ENABLED, SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED } from "../config/features";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app._index.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const [stats, requestStats, aiSpotlight, productCoverage, permissions, setupGuide, trust] = await Promise.all([
    getStoreReviewStats(store.id, { recentLimit: 5 }),
    reviewRequestService.getRequestStats(store.id),
    getLatestAiSummaryForStore(store.id),
    getProductReviewCoverage(store.id),
    getStorePermissions(store.id),
    getSetupGuideItems(store.id),
    // Real, cached read that transparently refreshes itself in the background once stale (see
    // getOrRefreshTrustCertification's own header comment) — never blocks this page load on
    // live Shopify latency, but also never shows a certification state older than 12 hours.
    getOrRefreshTrustCertification(admin, store.id),
  ]);

  // Reward stats are their own query only when the merchant has actually turned Rewards on —
  // store.rewardsEnabled is already on hand from getOrCreateStore above, no extra lookup needed
  // to decide whether to ask.
  const rewardStats = store.rewardsEnabled ? await getRewardStats(store.id) : null;

  return {
    storeName: store.name,
    storeDomain: store.domain,
    stats,
    requestStats,
    aiSpotlight,
    productCoverage,
    rewardStats,
    setupGuide,
    trust,
    automation: {
      // Two distinct, real facts — not one flag. Shopify's Protected Customer Data approval
      // (isApproved) was granted 2026-09-08; isLive is a separate, deliberate activation
      // switch (restoring the fulfillments/create webhook + read_fulfillments scope and
      // redeploying — see app/config/features.ts) that stays off until that's explicitly
      // decided, since flipping it starts real automatic emails for every merchant. canUse
      // reflects this store's plan; isEnabled reflects whether the merchant has actually
      // turned the setting on (irrelevant until isLive, but real).
      isApproved: SHOPIFY_PROTECTED_CUSTOMER_DATA_APPROVED,
      isLive: ORDER_AUTOMATION_ENABLED,
      canUse: permissions.canUseAutomaticReviewRequests,
      isEnabled: store.autoRequestEnabled,
    },
  };
};

// The Dashboard's only action: an explicit, merchant-triggered Trust Certification recheck.
// Always calls the real refreshTrustCertification (live Admin API + real Review rows) — there
// is no code path anywhere that lets a request just set a status directly.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);
  const formData = await request.formData();

  if (formData.get("intent") === "recheck-trust") {
    try {
      await refreshTrustCertification(admin, store.id);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unable to recheck Trust Certification." };
    }
  }

  return { ok: false, error: "Unknown action." };
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

// "Send a review request" is the header's own primary CTA now, not listed twice.
const QUICK_ACTIONS = [
  { label: "Moderate reviews", href: "/app/reviews?status=PENDING" },
  { label: "Configure scheduling", href: "/app/settings/requests" },
  { label: "Open Email Studio", href: "/app/email-studio" },
  { label: "Customize widgets", href: "/app/widgets" },
];

// Only a real, reachable destination — added to QUICK_ACTIONS below, not the static list
// above, since it only makes sense once the merchant has actually turned Rewards on.
const REWARDS_QUICK_ACTION = { label: "Manage Review Rewards", href: "/app/settings/rewards" };

const RATING_VALUES = [5, 4, 3, 2, 1] as const;

// Real, threshold-based status reads for a genuine percentage already on hand — never a
// fabricated trend or comparison. "Good" and "needs attention" cutoffs are the same honest
// bar a merchant would judge the number by themselves, just made visually explicit.
type KpiTone = "positive" | "attention" | "neutral";

function toneForShare(percent: number, goodAt: number, lowAt: number): KpiTone {
  if (percent >= goodAt) return "positive";
  if (percent < lowAt) return "attention";
  return "neutral";
}

const KPI_TONE_CLASS: Record<KpiTone, string> = {
  positive: "kpiTonePositive",
  attention: "kpiToneAttention",
  neutral: "",
};

// Real, existing ReviewStatus values only — a color cue on top of the text label already
// shown, never a replacement for it.
const ACTIVITY_STATUS_DOT_CLASS: Record<string, string> = {
  APPROVED: "activityDotSuccess",
  PENDING: "activityDotWarning",
  REJECTED: "activityDotNeutral",
};

// One shared entrance animation (styles.reveal — see its own comment in app._index.module.css)
// staggered by a plain inline custom property, so the page's major zones settle in as one
// considered moment rather than popping in all at once. A CSSProperties cast is needed since
// a custom property isn't a known style key to the DOM typings.
const revealStyle = (stepIndex: number): CSSProperties => ({ "--reveal-delay": `${stepIndex * 60}ms` }) as CSSProperties;

export default function Index() {
  const { storeName, storeDomain, stats, requestStats, aiSpotlight, productCoverage, rewardStats, setupGuide, trust, automation } =
    useLoaderData<typeof loader>();
  const incompleteSetupItems = setupGuide.filter((item) => !item.done);

  const trustFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const isRechecking = trustFetcher.state !== "idle";
  const pillarViews = buildPillarViews(trust, storeDomain);

  // Computed client-side (the merchant's local time), not in the loader (the server's) —
  // defaulting to a neutral greeting until mount avoids a server/client hydration mismatch.
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  }, []);

  const attentionCards = [
    {
      key: "pending",
      label: "Needs moderation",
      value: stats.pendingReviews,
      description: "Awaiting your approval or rejection.",
      href: "/app/reviews?status=PENDING",
    },
    {
      key: "held",
      label: "Held by Moderation Rules",
      value: stats.heldByRules,
      description: "Flagged automatically — worth a second look.",
      href: "/app/reviews?status=PENDING",
    },
  ];

  const verifiedPercent =
    stats.publishedReviews > 0 ? Math.round((stats.verifiedReviews / stats.publishedReviews) * 100) : 0;
  const maxRatingCount = Math.max(...RATING_VALUES.map((value) => stats.ratingCounts[value]), 1);
  const completionPercent = Math.round(requestStats.completionRate * 100);

  const verifiedTone = stats.publishedReviews > 0 ? toneForShare(verifiedPercent, 75, 40) : "neutral";
  const completionTone = requestStats.totalCount > 0 ? toneForShare(completionPercent, 60, 25) : "neutral";

  // Real, honest progress toward the one pillar with a genuinely gradual real ratio — the
  // other three pillars are permission-gated or binary, so a progress bar there would be
  // decorative, not truthful. Below the minimum count, progress is "how many of the 5
  // required verified reviews exist"; once past it, progress is "how close to the 95%
  // published threshold" — never both fabricated into one invented number.
  const reviewPracticesPillar = trust.pillars.reviewPractices;
  const reviewPracticesProgress =
    reviewPracticesPillar.verifiedReviewCount < MIN_VERIFIED_REVIEWS
      ? Math.round((reviewPracticesPillar.verifiedReviewCount / MIN_VERIFIED_REVIEWS) * 100)
      : Math.min(100, Math.round(((reviewPracticesPillar.percent ?? 0) / REVIEW_PRACTICES_THRESHOLD) * 100));

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <PageHeader
          title={`${greeting}, ${storeName}`}
          description={
            stats.pendingReviews > 0
              ? `${stats.pendingReviews} review${stats.pendingReviews === 1 ? "" : "s"} waiting for you.`
              : "You're all caught up — nothing needs your attention right now."
          }
          actions={
            <>
              <LinkButton to="/app/requests" variant="primary">
                Send a review request
              </LinkButton>
              <LinkButton to="/app/reviews" variant="secondary">
                View reviews
              </LinkButton>
            </>
          }
        />

        {/* Store reputation overview — the immediate "at a glance" read. Two hero stats
            (identity-defining: how good, how much proof) get real visual weight; the rest are
            secondary chips whose tone reflects a real, threshold-based read of the number
            itself — never an invented trend or period-over-period comparison this app has no
            historical snapshots to honestly support. */}
        <div className={`${styles.reputationRow} ${styles.reveal}`} style={revealStyle(0)}>
          <div className={styles.kpiHero}>
            <p className={styles.kpiHeroValue}>{stats.publishedReviews > 0 ? stats.averageRating.toFixed(1) : "—"}</p>
            {stats.publishedReviews > 0 ? (
              <StarRating value={stats.averageRating} size={16} />
            ) : (
              <p className={styles.kpiHeroSub}>No published reviews yet</p>
            )}
            <p className={styles.kpiHeroLabel}>Average rating</p>
          </div>
          <div className={styles.kpiHero}>
            <p className={styles.kpiHeroValue}>{stats.totalReviews}</p>
            <p className={styles.kpiHeroSub}>{stats.publishedReviews} published</p>
            <p className={styles.kpiHeroLabel}>Total reviews</p>
          </div>
          <div className={styles.kpiRow}>
            <div className={[styles.kpiCard, styles[KPI_TONE_CLASS[verifiedTone]]].filter(Boolean).join(" ")}>
              <p className={styles.kpiValue}>{verifiedPercent}%</p>
              <p className={styles.kpiLabel}>Verified share</p>
            </div>
            <div className={[styles.kpiCard, styles[KPI_TONE_CLASS[completionTone]]].filter(Boolean).join(" ")}>
              <p className={styles.kpiValue}>{completionPercent}%</p>
              <p className={styles.kpiLabel}>Request completion</p>
            </div>
            <div className={styles.kpiCard}>
              <p className={styles.kpiValue}>{stats.autoPublishedToday}</p>
              <p className={styles.kpiLabel}>Auto-published today</p>
            </div>
          </div>
        </div>

        {incompleteSetupItems.length > 0 ? (
          <Section
            className={styles.reveal}
            style={revealStyle(1)}
            title="Getting started"
            description={`${setupGuide.length - incompleteSetupItems.length} of ${setupGuide.length} done.`}
          >
            <div className={styles.setupGuideGrid}>
              {setupGuide.map((item) => (
                <Link
                  key={item.key}
                  to={item.href}
                  className={`${styles.setupGuideCard} ${item.done ? styles.setupGuideCardDone : ""}`}
                >
                  <span className={styles.setupGuideCheck} aria-hidden="true">
                    {item.done ? "✓" : ""}
                  </span>
                  <span>
                    <span className={styles.setupGuideLabel}>{item.label}</span>
                    <span className={styles.setupGuideDescription}>{item.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        ) : null}

        <nav className={`${styles.quickActions} ${styles.reveal}`} style={revealStyle(2)} aria-label="Quick actions">
          {(rewardStats ? [...QUICK_ACTIONS, REWARDS_QUICK_ACTION] : QUICK_ACTIONS).map((action) => (
            <Link key={action.href} to={action.href} className={styles.quickActionChip}>
              {action.label}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          ))}
        </nav>

        <div className={`${styles.group} ${styles.reveal}`} style={revealStyle(3)}>
          <p className={styles.groupLabel}>Needs your attention</p>
          <div className={styles.attentionGrid}>
            {attentionCards.map((item) => (
            <Link
              key={item.key}
              to={item.href}
              className={`${styles.attentionCard} ${item.value > 0 ? styles.attentionCardActive : ""}`}
            >
              <div className={styles.attentionCopy}>
                <p className={styles.attentionLabel}>
                  {item.value > 0 ? <span className={styles.attentionDot} aria-hidden="true" /> : null}
                  {item.label}
                </p>
                <p className={styles.attentionValue}>{item.value}</p>
                <p className={styles.attentionDescription}>
                  {item.value > 0 ? item.description : "All caught up."}
                </p>
              </div>
              <span className={styles.attentionArrow} aria-hidden="true">
                &rarr;
              </span>
            </Link>
            ))}
          </div>
        </div>

        {/* Real positive-moment gate, not a timer: at least 5 real published reviews means this
            store has genuinely gotten value out of the app, not just installed it. See
            AppReviewPrompt's own header comment for why "Leave a review" needs no App Store URL
            here at all. */}
        <AppReviewPrompt eligible={stats.publishedReviews >= 5} />

        {/* Both conditions are real and orthogonal — a brand-new store and Shopify's pending
            approval are two different things a merchant might need to know, so both can show
            at once rather than picking one to suppress the other. */}
        <div className={`${styles.banners} ${styles.reveal}`} style={revealStyle(4)}>
          {stats.totalReviews === 0 ? (
            <Banner
              title="Collect your first review"
              description="Send a review request to a real customer to get your first review in — it's the fastest way to see how Imagyn Reviews works end to end."
              action={{ label: "Send a review request", href: "/app/requests" }}
            />
          ) : null}
          {!automation.isApproved ? (
            <Banner
              tone="warning"
              title="Automatic review requests are pending Shopify approval"
              description="Reading order fulfillment details requires Shopify's Protected Customer Data approval for this app, which hasn't been granted yet. This activates automatically once it is — manual requests (including their full reminder schedule) are unaffected and fully available today."
              action={{ label: "View request scheduling", href: "/app/settings/requests" }}
            />
          ) : !automation.isLive ? (
            <Banner
              tone="warning"
              title="Automatic review requests: approved, activating soon"
              description="Shopify has approved this app to read order fulfillment details for automatic review requests. We're finishing turning this on — it'll activate here automatically, with no action needed from you. Manual requests (including their full reminder schedule) are unaffected and fully available today."
              action={{ label: "View request scheduling", href: "/app/settings/requests" }}
            />
          ) : automation.canUse && !automation.isEnabled ? (
            <Banner
              title="Automatic review requests are off"
              description="Turn this on to automatically request a review after every fulfilled order, on your own configured schedule."
              action={{ label: "Turn on", href: "/app/settings/requests" }}
            />
          ) : null}
        </div>

        <div className={`${styles.group} ${styles.reveal}`} style={revealStyle(5)}>
          <p className={styles.groupLabel}>Setup &amp; health</p>
          <div className={styles.healthGrid}>
            <Card className={styles.healthCard}>
              <p className={styles.healthCardTitle}>Products needing attention</p>
              {productCoverage.totalProducts === 0 ? (
                <p className={styles.healthCardText}>
                  No products synced yet. <Link to="/app/products">Sync your catalog</Link> to start connecting
                  reviews to products.
                </p>
              ) : productCoverage.withoutReviews === 0 ? (
                <>
                  <p className={styles.healthCardValue}>All {productCoverage.totalProducts} covered</p>
                  <p className={styles.healthCardText}>Every synced product has at least one review.</p>
                </>
              ) : (
                <>
                  <p className={styles.healthCardValue}>
                    {productCoverage.withoutReviews} of {productCoverage.totalProducts}
                  </p>
                  <p className={styles.healthCardText}>
                    Products with no reviews yet. <Link to="/app/requests">Request reviews</Link> for their recent
                    buyers.
                  </p>
                </>
              )}
            </Card>

            {rewardStats ? (
              <Card className={styles.healthCard}>
                <p className={styles.healthCardTitle}>Review Rewards</p>
                <p className={styles.healthCardValue}>{rewardStats.issued} issued</p>
                <p className={styles.healthCardText}>
                  {rewardStats.pending > 0 ? `${rewardStats.pending} pending · ` : ""}
                  {rewardStats.failed > 0 ? `${rewardStats.failed} failed · ` : ""}
                  <Link to="/app/settings/rewards">Manage rewards</Link>
                </p>
              </Card>
            ) : null}
          </div>
        </div>

        <Card className={styles.reveal} style={revealStyle(6)}>
          <Section
            title="Trust & Certification"
            description="IMAGYN's real-time verification of how trustworthy your store looks to shoppers — every pillar is calculated from your real store data, never manually set."
            actions={
              <trustFetcher.Form method="post">
                <input type="hidden" name="intent" value="recheck-trust" />
                <Button type="submit" variant="secondary" disabled={isRechecking}>
                  {isRechecking ? "Rechecking…" : "Recheck now"}
                </Button>
              </trustFetcher.Form>
            }
          >
            {trustFetcher.data && !trustFetcher.data.ok ? (
              <p className={styles.errorText}>{trustFetcher.data.error ?? "Unable to recheck Trust Certification."}</p>
            ) : null}

            <div className={styles.trustCertStatusBlock}>
              <div className={styles.trustCertStatusMain}>
                <StatusBadge tone={OVERALL_STATUS_TONE[trust.status]}>{OVERALL_STATUS_LABEL[trust.status]}</StatusBadge>
                <p className={styles.trustCertSummary}>{OVERALL_STATUS_SUMMARY[trust.status]}</p>
              </div>
              <div className={styles.trustRow}>
                <div className={styles.trustStat}>
                  <p className={styles.trustValue}>{trust.verifiedReviewCount}</p>
                  <p className={styles.trustLabel}>Verified reviews</p>
                </div>
                <div className={styles.trustStat}>
                  <p className={styles.trustValue}>
                    {trust.verifiedReviewCount > 0 ? trust.verifiedAverageRating.toFixed(1) : "—"}
                  </p>
                  <p className={styles.trustLabel}>Verified average rating</p>
                </div>
              </div>
            </div>

            <div className={styles.pillarGrid}>
              {pillarViews.map((pillar) => (
                <div key={pillar.key} className={styles.pillarCard}>
                  <div className={styles.pillarCardHeader}>
                    <PillarStatusIcon status={pillar.status} />
                    <div>
                      <p className={styles.pillarTitle}>{pillar.title}</p>
                      <StatusBadge tone={PILLAR_STATUS_TONE[pillar.status]}>{PILLAR_STATUS_LABEL[pillar.status]}</StatusBadge>
                    </div>
                  </div>
                  {pillar.key === "reviewPractices" ? (
                    <div className={styles.pillarProgressTrack} role="presentation">
                      <div className={styles.pillarProgressFill} style={{ width: `${reviewPracticesProgress}%` }} />
                    </div>
                  ) : null}
                  <p className={styles.pillarDetail}>{pillar.detail}</p>
                  {pillar.actionHref ? (
                    <a
                      className={styles.spotlightLink}
                      href={pillar.actionHref}
                      target={pillar.external ? "_blank" : undefined}
                      rel={pillar.external ? "noreferrer" : undefined}
                    >
                      {pillar.actionLabel} &rarr;
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        </Card>

        <div className={`${styles.insightsGrid} ${styles.reveal}`} style={revealStyle(7)}>
          <Card>
            <Section title="Rating Distribution" description="Approved reviews, by star rating.">
              {stats.publishedReviews === 0 ? (
                <p className={styles.mutedText}>Ratings will appear here once reviews are approved.</p>
              ) : (
                <div className={styles.ratingBars}>
                  {RATING_VALUES.map((value) => {
                    const count = stats.ratingCounts[value];
                    const widthPercent = Math.round((count / maxRatingCount) * 100);
                    const sharePercent =
                      stats.publishedReviews > 0 ? Math.round((count / stats.publishedReviews) * 100) : 0;

                    return (
                      <div key={value} className={styles.ratingBarRow}>
                        <span className={styles.ratingBarLabel}>{value}★</span>
                        <span className={styles.ratingBarTrack}>
                          <span className={styles.ratingBarFill} style={{ width: `${widthPercent}%` }} />
                        </span>
                        <span className={styles.ratingBarCount}>
                          {count} ({sharePercent}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </Card>

          <Card className={styles.aiCard}>
            <Section title="AI Spotlight" description="The latest AI summary generated for one of your products.">
              {aiSpotlight ? (
                <div className={styles.aiSpotlight}>
                  <span className={styles.aiBadge}>AI-generated</span>
                  <p className={styles.aiSpotlightProduct}>{aiSpotlight.productName}</p>
                  <p className={styles.aiSpotlightText}>{aiSpotlight.recommendation}</p>
                  <Link to={`/app/products/${aiSpotlight.productId}`} className={styles.spotlightLink}>
                    View full summary &rarr;
                  </Link>
                </div>
              ) : (
                <div className={styles.aiSpotlight}>
                  <p className={styles.mutedText}>
                    AI summaries surface what customers love (and don&apos;t) about a product, generated from its
                    approved reviews.
                  </p>
                  <Link to="/app/products" className={styles.spotlightLink}>
                    Visit a product to generate one &rarr;
                  </Link>
                </div>
              )}
            </Section>
          </Card>
        </div>

        {/* Automation status folded in at the top — merged from what used to be a separate
            "Automation & reminders" health card, so this one section answers "is review
            collection actually working" instead of splitting status from performance. */}
        <Card className={styles.reveal} style={revealStyle(8)}>
          <Section title="Review Requests" description="How your automated and manual requests are performing.">
            <div className={styles.automationStatus}>
              <StatusBadge
                tone={
                  !automation.isApproved || !automation.isLive
                    ? "warning"
                    : automation.isEnabled
                      ? "success"
                      : "neutral"
                }
              >
                {!automation.isApproved
                  ? "Pending Shopify"
                  : !automation.isLive
                    ? "Approved — activating soon"
                    : automation.isEnabled
                      ? "Automatic requests on"
                      : "Automatic requests off"}
              </StatusBadge>
              <p className={styles.automationStatusText}>
                {!automation.isApproved || !automation.isLive
                  ? "Manual requests and their reminder schedule work fully today."
                  : automation.isEnabled
                    ? "New fulfilled orders automatically get a review request."
                    : "Turn on automatic requests in Request Scheduling."}{" "}
                <Link to="/app/settings/requests">Manage scheduling</Link>
              </p>
            </div>

            {requestStats.totalCount > 0 ? (
              <div className={styles.trustRow}>
                <div className={styles.trustStat}>
                  <p className={styles.trustValue}>{requestStats.scheduled + requestStats.pending}</p>
                  <p className={styles.trustLabel}>Scheduled</p>
                </div>
                <div className={styles.trustStat}>
                  <p className={styles.trustValue}>{requestStats.sent}</p>
                  <p className={styles.trustLabel}>Sent</p>
                </div>
                <div className={styles.trustStat}>
                  <p className={styles.trustValue}>{requestStats.completed}</p>
                  <p className={styles.trustLabel}>Completed</p>
                </div>
                <div className={styles.trustStat}>
                  <p className={styles.trustValue}>{completionPercent}%</p>
                  <p className={styles.trustLabel}>Completion rate</p>
                </div>
              </div>
            ) : (
              <p className={styles.mutedText}>
                No review requests sent yet. <Link to="/app/requests">Send your first one</Link> to start seeing
                activity and completion rate here.
              </p>
            )}
          </Section>
        </Card>

        <Card className={styles.reveal} style={revealStyle(9)}>
          <Section title="Recent Activity" description="The latest review and request events for your store.">
            {stats.recentReviews.length === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Review submissions, approvals, and requests will appear here as customers share their experience."
                action={{ label: "Send a review request", href: "/app/requests" }}
              />
            ) : (
              <ul className={styles.activityList}>
                {stats.recentReviews.map((review) => (
                  <li key={review.id} className={styles.activityItem}>
                    <div className={styles.activityRating}>
                      <StarRating value={review.rating} size={14} />
                    </div>
                    <div className={styles.activityContent}>
                      <p className={styles.activityTitle}>
                        {review.reviewerName} &middot; {review.productTitle ?? review.product?.name ?? "Unassigned product"}
                      </p>
                      <p className={styles.activityMeta}>
                        <span
                          className={[styles.activityDot, styles[ACTIVITY_STATUS_DOT_CLASS[review.status]]]
                            .filter(Boolean)
                            .join(" ")}
                          aria-hidden="true"
                        />
                        {review.status.charAt(0) + review.status.slice(1).toLowerCase()} &middot; {formatDate(review.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Card>
      </div>
    </Container>
  );
}
