import { useLoaderData, useRouteError } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Medallion } from "../components/medals/Medallion";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { evaluateAchievements } from "../services/achievements.server";
import { groupByFamily, type AchievementStatus } from "../services/achievements.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.medals.module.css";

type LoaderData = {
  families: Array<{ family: string; statuses: AchievementStatus[] }>;
  earnedCount: number;
  totalCount: number;
};

const FAMILY_TITLES: Record<string, string> = {
  verified_voices: "Verified Voices",
  peak_month: "Peak Month",
  trust: "Trust",
  top_stores: "Top Stores",
  trending: "Trending",
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const statuses = await evaluateAchievements(store.id);
  const grouped = groupByFamily(statuses);

  const families = Array.from(grouped.entries()).map(([family, familyStatuses]) => ({
    family,
    statuses: familyStatuses,
  }));

  return {
    families,
    earnedCount: statuses.filter((status) => status.unlocked).length,
    totalCount: statuses.length,
  };
};

function formatEarnedDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function MedalCard({ status }: { status: AchievementStatus }) {
  const isPercentTarget = status.category === "trust" || status.category === "ranking";

  return (
    <Card className={`${styles.medalCard} ${status.unlocked ? styles.medalCardUnlocked : ""}`}>
      <Medallion category={status.category} unlocked={status.unlocked} tier={status.tier} size={64} />
      <div className={styles.medalBody}>
        <p className={styles.medalName}>{status.name}</p>
        <p className={styles.medalDescription}>{status.description}</p>

        {status.unlocked ? (
          status.earnedAt ? (
            <p className={styles.medalMeta}>Earned {formatEarnedDate(status.earnedAt)}</p>
          ) : (
            <p className={styles.medalMeta}>Active now</p>
          )
        ) : status.progress ? (
          <div className={styles.medalProgress}>
            <ProgressBar
              percent={
                status.progress.target > 0
                  ? Math.min(100, Math.round((status.progress.current / status.progress.target) * 100))
                  : 0
              }
              label={`${status.progress.current}${isPercentTarget ? "%" : ""} of ${status.progress.target}${isPercentTarget ? "%" : ""}`}
            />
          </div>
        ) : (
          <p className={styles.medalMeta}>Not yet earned</p>
        )}
      </div>
    </Card>
  );
}

export default function MedalsPage() {
  const { families, earnedCount, totalCount } = useLoaderData<typeof loader>();

  return (
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={shellStyles.header}>
          <div className={shellStyles.headerContent}>
            <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
            <h1 className={shellStyles.title}>Medals</h1>
            <p className={shellStyles.subtitle}>
              Achievements earned automatically from your real review activity — {earnedCount} of {totalCount} earned so far.
            </p>
          </div>
        </header>

        {families.map(({ family, statuses }) => (
          <Section key={family} title={FAMILY_TITLES[family] ?? family}>
            <div className={styles.medalGrid}>
              {statuses.map((status) => (
                <MedalCard key={status.key} status={status} />
              ))}
            </div>
          </Section>
        ))}
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
