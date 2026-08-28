import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { StarRating } from "../components/reviews/StarRating";
import { getStoreReviewStats } from "../services/review.server";
import { reviewRequestService } from "../services/review-request.server";
import { getLatestAiSummaryForStore } from "../services/aiSummary.server";
import { getOrCreateStore } from "../services/store.server";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app._index.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const [stats, requestStats, aiSpotlight] = await Promise.all([
    getStoreReviewStats(store.id, { recentLimit: 5 }),
    reviewRequestService.getRequestStats(store.id),
    getLatestAiSummaryForStore(store.id),
  ]);

  return { storeName: store.name, stats, requestStats, aiSpotlight };
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

const QUICK_ACTIONS = [
  { label: "Moderate reviews", href: "/app/reviews?status=PENDING" },
  { label: "Send a review request", href: "/app/requests" },
  { label: "Customize widgets", href: "/app/widgets" },
  { label: "Open Brand Studio", href: "/app/appearance" },
];

const RATING_VALUES = [5, 4, 3, 2, 1] as const;

export default function Index() {
  const { storeName, stats, requestStats, aiSpotlight } = useLoaderData<typeof loader>();

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
