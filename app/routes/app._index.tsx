import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { Card } from "../components/ui/Card";
import { LinkButton } from "../components/ui/LinkButton";
import { AppReviewPrompt } from "../components/ui/AppReviewPrompt";
import { StarRating } from "../components/reviews/StarRating";
import { getStoreReviewStats } from "../services/review.server";
import { reviewRequestService } from "../services/review-request.server";
import { getLatestAiSummaryForStore } from "../services/aiSummary.server";
import { getProductReviewCoverage } from "../services/product.server";
import { getRewardStats } from "../services/rewards.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { ORDER_AUTOMATION_ENABLED } from "../config/features";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app._index.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const [stats, requestStats, aiSpotlight, productCoverage, permissions] = await Promise.all([
    getStoreReviewStats(store.id, { recentLimit: 5 }),
    reviewRequestService.getRequestStats(store.id),
    getLatestAiSummaryForStore(store.id),
    getProductReviewCoverage(store.id),
    getStorePermissions(store.id),
  ]);

  // Reward stats are their own query only when the merchant has actually turned Rewards on —
  // store.rewardsEnabled is already on hand from getOrCreateStore above, no extra lookup needed
  // to decide whether to ask.
  const rewardStats = store.rewardsEnabled ? await getRewardStats(store.id) : null;

  return {
    storeName: store.name,
    stats,
    requestStats,
    aiSpotlight,
    productCoverage,
    rewardStats,
    automation: {
      // Real, current state — not a guess: the webhook this depends on isn't subscribed yet
      // (see webhooks.fulfillments.create.tsx / shopify.app.toml), pending Shopify's Protected
      // Customer Data approval. canUse reflects this store's plan; isEnabled reflects whether
      // the merchant has actually turned the setting on (irrelevant while blocked, but real).
      isBlockedByShopify: !ORDER_AUTOMATION_ENABLED,
      canUse: permissions.canUseAutomaticReviewRequests,
      isEnabled: store.autoRequestEnabled,
    },
  };
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

const RATING_VALUES = [5, 4, 3, 2, 1] as const;

export default function Index() {
  const { storeName, stats, requestStats, aiSpotlight, productCoverage, rewardStats, automation } =
    useLoaderData<typeof loader>();

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

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={shellStyles.header}>
          <div className={shellStyles.headerContent}>
            <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
            <h1 className={shellStyles.title}>
              {greeting}, {storeName}
            </h1>
            <p className={shellStyles.subtitle}>
              {stats.pendingReviews > 0
                ? `${stats.pendingReviews} review${stats.pendingReviews === 1 ? "" : "s"} waiting for you.`
                : "You're all caught up — nothing needs your attention right now."}
            </p>
          </div>
          <div className={styles.headerActions}>
            <LinkButton to="/app/requests" variant="primary">
              Send a review request
            </LinkButton>
            <LinkButton to="/app/reviews" variant="secondary">
              View reviews
            </LinkButton>
          </div>
        </header>

        <nav className={styles.quickActions} aria-label="Quick actions">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.href} to={action.href} className={styles.quickActionLink}>
              {action.label}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          ))}
        </nav>

        <div className={styles.attentionGrid}>
          {attentionCards.map((item) => (
            <Link
              key={item.key}
              to={item.href}
              className={`${styles.attentionCard} ${item.value > 0 ? styles.attentionCardActive : ""}`}
            >
              <div className={styles.attentionCopy}>
                <p className={styles.attentionLabel}>{item.label}</p>
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

        {/* Real positive-moment gate, not a timer: at least 5 real published reviews means this
            store has genuinely gotten value out of the app, not just installed it. See
            AppReviewPrompt's own header comment for why "Leave a review" needs no App Store URL
            here at all. */}
        <AppReviewPrompt eligible={stats.publishedReviews >= 5} />

        {/* Both conditions are real and orthogonal — a brand-new store and Shopify's pending
            approval are two different things a merchant might need to know, so both can show
            at once rather than picking one to suppress the other. */}
        <div className={styles.banners}>
          {stats.totalReviews === 0 ? (
            <div className={styles.banner}>
              <div className={styles.bannerText}>
                <p className={styles.bannerTitle}>Collect your first review</p>
                <p className={styles.bannerSubtitle}>
                  Send a review request to a real customer to get your first review in — it&apos;s the fastest way
                  to see how Imagyn Reviews works end to end.
                </p>
              </div>
              <Link to="/app/requests" className={styles.bannerLink}>
                Send a review request &rarr;
              </Link>
            </div>
          ) : null}
          {automation.isBlockedByShopify ? (
            <div className={styles.banner}>
              <div className={styles.bannerText}>
                <p className={styles.bannerTitle}>Automatic review requests are pending Shopify approval</p>
                <p className={styles.bannerSubtitle}>
                  Reading order fulfillment details requires Shopify&apos;s Protected Customer Data approval for
                  this app, which hasn&apos;t been granted yet. This activates automatically once it is — manual
                  requests (including their full reminder schedule) are unaffected and fully available today.
                </p>
              </div>
              <Link to="/app/settings/requests" className={styles.bannerLink}>
                View request scheduling &rarr;
              </Link>
            </div>
          ) : automation.canUse && !automation.isEnabled ? (
            <div className={styles.banner}>
              <div className={styles.bannerText}>
                <p className={styles.bannerTitle}>Automatic review requests are off</p>
                <p className={styles.bannerSubtitle}>
                  Turn this on to automatically request a review after every fulfilled order, on your own
                  configured schedule.
                </p>
              </div>
              <Link to="/app/settings/requests" className={styles.bannerLink}>
                Turn on &rarr;
              </Link>
            </div>
          ) : null}
        </div>

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

          <Card className={styles.healthCard}>
            <p className={styles.healthCardTitle}>Automation &amp; reminders</p>
            <p className={styles.healthCardValue}>
              {automation.isBlockedByShopify ? "Pending Shopify" : automation.isEnabled ? "On" : "Off"}
            </p>
            <p className={styles.healthCardText}>
              {automation.isBlockedByShopify
                ? "Manual requests and their reminder schedule work fully today."
                : automation.isEnabled
                  ? "New fulfilled orders automatically get a review request."
                  : "Turn on automatic requests in Request Scheduling."}{" "}
              <Link to="/app/settings/requests">Manage scheduling</Link>
            </p>
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

        <Section title="Trust Overview" description="How your store looks to shoppers right now.">
          <div className={styles.trustRow}>
            <div className={styles.trustStat}>
              <p className={styles.trustValue}>{stats.publishedReviews > 0 ? stats.averageRating.toFixed(1) : "—"}</p>
              <p className={styles.trustLabel}>Average rating</p>
            </div>
            <div className={styles.trustStat}>
              <p className={styles.trustValue}>{verifiedPercent}%</p>
              <p className={styles.trustLabel}>Verified reviews</p>
            </div>
            <div className={styles.trustStat}>
              <p className={styles.trustValue}>{stats.totalReviews}</p>
              <p className={styles.trustLabel}>Total reviews</p>
            </div>
            <div className={styles.trustStat}>
              <p className={styles.trustValue}>{stats.autoPublishedToday}</p>
              <p className={styles.trustLabel}>Auto-published today</p>
            </div>
          </div>
        </Section>

        <div className={styles.insightsGrid}>
          <Section title="Rating Distribution" description="Approved reviews, by star rating.">
            {stats.publishedReviews === 0 ? (
              <p className={styles.mutedText}>Ratings will appear here once reviews are approved.</p>
            ) : (
              <div className={styles.ratingBars}>
                {RATING_VALUES.map((value) => {
                  const count = stats.ratingCounts[value];
                  const widthPercent = Math.round((count / maxRatingCount) * 100);

                  return (
                    <div key={value} className={styles.ratingBarRow}>
                      <span className={styles.ratingBarLabel}>{value}★</span>
                      <span className={styles.ratingBarTrack}>
                        <span className={styles.ratingBarFill} style={{ width: `${widthPercent}%` }} />
                      </span>
                      <span className={styles.ratingBarCount}>{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="AI Spotlight" description="The latest AI summary generated for one of your products.">
            {aiSpotlight ? (
              <div className={styles.aiSpotlight}>
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
        </div>

        {requestStats.totalCount > 0 ? (
          <Section title="Review Requests" description="How your automated and manual requests are performing.">
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
          </Section>
        ) : null}

        <Section title="Recent Activity" description="The latest review and request events for your store.">
          {stats.recentReviews.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateContent}>
                <h2 className={styles.emptyStateTitle}>No activity yet</h2>
                <p className={styles.emptyStateText}>
                  Review submissions, approvals, and requests will appear here as customers share their experience.
                </p>
              </div>
            </div>
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
                      {review.status.charAt(0) + review.status.slice(1).toLowerCase()} &middot; {formatDate(review.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Container>
  );
}
