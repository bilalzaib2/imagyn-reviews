import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { Container } from "../components/ui/Container";
import { Card } from "../components/ui/Card";
import { Section } from "../components/ui/Section";
import { StarRating } from "../components/reviews/StarRating";
import { getStoreReviewStats } from "../services/review.server";
import { getOrCreateStore } from "../services/store.server";
import { authenticate } from "../shopify.server";
import styles from "../styles/app._index.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await getOrCreateStore(session.shop);
  const stats = await getStoreReviewStats(store.id, { recentLimit: 5 });

  return { stats };
};

const formatDate = (value: Date) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

export default function Index() {
  const { stats } = useLoaderData<typeof loader>();

  const statCards = [
    { label: "Total Reviews", value: String(stats.totalReviews) },
    {
      label: "Average Rating",
      value: stats.publishedReviews > 0 ? stats.averageRating.toFixed(1) : "—",
    },
    { label: "Pending Reviews", value: String(stats.pendingReviews) },
    { label: "Published Reviews", value: String(stats.publishedReviews) },
  ];

  return (
    <Container as="main">
      <div className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Imagyn Reviews</p>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Monitor your reviews and customer feedback.</p>
        </header>

        <div className={styles.statsGrid}>
          {statCards.map((stat) => (
            <Card key={stat.label}>
              <div className={styles.statContent}>
                <p className={styles.statLabel}>{stat.label}</p>
                <p className={styles.statValue}>{stat.value}</p>
              </div>
            </Card>
          ))}
        </div>

        <Section title="Recent Activity" description="The latest review and request events for your store.">
          {stats.recentReviews.length === 0 ? (
            <Card tone="subtle">
              <div className={styles.emptyState}>
                <div className={styles.emptyStateContent}>
                  <h2 className={styles.emptyStateTitle}>No activity yet</h2>
                  <p className={styles.emptyStateText}>
                    Review submissions, approvals, and requests will appear here as customers share their experience.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card tone="subtle">
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
            </Card>
          )}
        </Section>
      </div>
    </Container>
  );
}
