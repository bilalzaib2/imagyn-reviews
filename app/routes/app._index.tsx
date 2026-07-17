import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Container } from "../components/ui/Container";
import { Card } from "../components/ui/Card";
import { Section } from "../components/ui/Section";
import styles from "../styles/app._index.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  const stats = [
    { label: "Average Rating", value: "4.9★" },
    { label: "Reviews", value: "1,284" },
    { label: "Pending", value: "18" },
    { label: "Conversion", value: "12.6%" },
  ];

  return (
    <Container as="main">
      <div className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Imagyn Reviews</p>
          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>
            Your review operations are ready for the next wave of customer
            feedback.
          </p>
        </header>

        <div className={styles.statsGrid}>
          {stats.map((stat) => (
            <Card key={stat.label}>
              <div className={styles.statContent}>
                <p className={styles.statLabel}>{stat.label}</p>
                <p className={styles.statValue}>{stat.value}</p>
              </div>
            </Card>
          ))}
        </div>

        <Section
          title="Recent Reviews"
          description="Customer feedback will appear here once reviews are collected."
        >
          <Card tone="subtle">
            <div className={styles.emptyState}>
              <div className={styles.emptyStateContent}>
                <h2 className={styles.emptyStateTitle}>No reviews yet</h2>
                <p className={styles.emptyStateText}>
                  Reviews will appear here as customers share their experiences.
                </p>
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
