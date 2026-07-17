import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useNavigation, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Container } from "../components/ui/Container";
import { Card } from "../components/ui/Card";
import { Section } from "../components/ui/Section";
import { reviewService } from "../services/review.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app._index.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  try {
    const stats = await reviewService.getDashboardStats();
    return { stats, error: null };
  } catch (error) {
    return {
      stats: {
        averageRating: 0,
        totalReviews: 0,
        pendingReviews: 0,
        verifiedPurchaseRate: 0,
      },
      error: error instanceof Error ? error.message : "Unable to load dashboard stats.",
    };
  }
};

export default function Index() {
  const { stats: dashboardStats, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  const cards = [
    { label: "Average Rating", value: `${dashboardStats.averageRating.toFixed(1)}★` },
    { label: "Total Reviews", value: `${dashboardStats.totalReviews}` },
    { label: "Pending Reviews", value: `${dashboardStats.pendingReviews}` },
    { label: "Verified Purchase %", value: `${dashboardStats.verifiedPurchaseRate}%` },
  ];

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>Welcome back</h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
              Your review operations are ready for the next wave of customer
              feedback.
            </p>
          </div>
        </header>

        <div className={styles.statsGrid}>
          {cards.map((stat) => (
            <Card key={stat.label}>
              <div className={styles.statContent}>
                <p className={styles.statLabel}>{stat.label}</p>
                <p className={styles.statValue}>{stat.value}</p>
              </div>
            </Card>
          ))}
        </div>

        {error ? <p className={styles.errorText}>{error}</p> : null}
        {isLoading ? <p className={styles.mutedText}>Refreshing dashboard…</p> : null}

        <Section
          title="Recent Reviews"
          description="Customer feedback will appear here once reviews are collected."
        >
          <Card tone="subtle">
            <div className={styles.emptyState}>
              <div className={styles.emptyStateContent}>
                {dashboardStats.totalReviews === 0 ? (
                  <>
                    <h2 className={styles.emptyStateTitle}>No reviews yet</h2>
                    <p className={styles.emptyStateText}>
                      Reviews will appear here as customers share their experiences.
                    </p>
                    <Link className={styles.emptyStateLink} to="/app/reviews">
                      Open Reviews
                    </Link>
                  </>
                ) : (
                  <>
                    <h2 className={styles.emptyStateTitle}>Reviews are flowing in</h2>
                    <p className={styles.emptyStateText}>
                      Open Reviews to inspect customer sentiment, status, and product context.
                    </p>
                    <Link className={styles.emptyStateLink} to="/app/reviews">
                      Inspect Reviews
                    </Link>
                  </>
                )}
              </div>
            </div>
          </Card>
        </Section>
      </div>
    </Container>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
