import { Container } from "../components/ui/Container";
import { Card } from "../components/ui/Card";
import { Section } from "../components/ui/Section";
import styles from "../styles/app._index.module.css";

const stats = [
  { label: "Total Reviews", value: "0" },
  { label: "Average Rating", value: "—" },
  { label: "Pending Requests", value: "0" },
  { label: "Published Reviews", value: "0" },
];

export default function Index() {
  return (
    <Container as="main">
      <div className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Imagyn Reviews</p>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.subtitle}>Monitor your reviews and customer feedback.</p>
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

        <Section title="Recent Activity" description="The latest review and request events for your store.">
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
        </Section>
      </div>
    </Container>
  );
}
