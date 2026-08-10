import { useFetcher, useLoaderData, useNavigation, useRouteError } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { Card } from "../components/ui/Card";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { UpgradePrompt } from "../components/ui/UpgradePrompt";
import { authenticateAdminDeduped } from "../services/auth-dedupe.server";
import { getOrCreateStore } from "../services/store.server";
import { getStorePermissions } from "../services/permissions";
import {
  getAiInsightsDigest,
  getConversionInsights,
  getReviewAnalytics,
  getRequestAnalytics,
  type AiInsightsDigestEntry,
  type ConversionInsights,
  type ReviewAnalytics,
  type RequestAnalytics,
} from "../services/analytics.server";
import { ANALYTICS_DATE_RANGES, isValidAnalyticsDateRange, type AnalyticsDateRange } from "../services/analytics.shared";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.analytics.module.css";

type LoaderData = {
  range: AnalyticsDateRange;
  reviewAnalytics: ReviewAnalytics;
  requestAnalytics: RequestAnalytics;
  conversionInsights: ConversionInsights | null;
  aiDigest: AiInsightsDigestEntry[] | null;
  canUseAnalytics: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticateAdminDeduped(request);
  const store = await getOrCreateStore(session.shop);

  const url = new URL(request.url);
  const rangeParam = url.searchParams.get("range");
  const range: AnalyticsDateRange = isValidAnalyticsDateRange(rangeParam) ? rangeParam : "30d";

  const permissions = await getStorePermissions(store.id);

  const [reviewAnalytics, requestAnalytics, conversionInsights, aiDigest] = await Promise.all([
    getReviewAnalytics(store.id, range),
    getRequestAnalytics(store.id, range),
    permissions.canUseAnalytics ? getConversionInsights(store.id, range) : Promise.resolve(null),
    permissions.canUseAnalytics ? getAiInsightsDigest(store.id) : Promise.resolve(null),
  ]);

  return {
    range,
    reviewAnalytics,
    requestAnalytics,
    conversionInsights,
    aiDigest,
    canUseAnalytics: permissions.canUseAnalytics,
  };
};

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const formatCount = (value: number) => new Intl.NumberFormat("en").format(value);

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryCard}>
      <p className={styles.summaryValue}>{value}</p>
      <p className={styles.summaryLabel}>{label}</p>
    </div>
  );
}

const RATING_VALUES = [5, 4, 3, 2, 1] as const;

function RatingDistribution({ ratingCounts }: { ratingCounts: ReviewAnalytics["ratingCounts"] }) {
  const maxCount = Math.max(...RATING_VALUES.map((value) => ratingCounts[value]), 1);

  return (
    <div className={styles.ratingBars}>
      {RATING_VALUES.map((value) => {
        const count = ratingCounts[value];
        const widthPercent = Math.round((count / maxCount) * 100);
        return (
          <div key={value} className={styles.ratingBarRow}>
            <span className={styles.ratingBarLabel}>{value}★</span>
            <span className={styles.ratingBarTrack}>
              <span className={styles.ratingBarFill} style={{ width: `${widthPercent}%` }} />
            </span>
            <span className={styles.ratingBarCount}>{formatCount(count)}</span>
          </div>
        );
      })}
    </div>
  );
}

// A deliberately minimal trend chart — bars only, no axis clutter, matching the "typography
// does the work" restraint already established for the dashboard's rating bars. Per-bar date
// labels would be unreadable past ~14 bars (a 90-day range), so only the range's start/end
// dates are captioned below instead.
function TrendChart({ trend }: { trend: Array<{ date: string; count: number }> }) {
  if (trend.length === 0) {
    return <p className={styles.mutedText}>No activity in this range yet.</p>;
  }

  const maxCount = Math.max(...trend.map((point) => point.count), 1);
  const formatShortDate = (value: string) =>
    new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));

  return (
    <div>
      <div className={styles.trendChart}>
        {trend.map((point) => (
          <div key={point.date} className={styles.trendBarColumn} title={`${formatShortDate(point.date)}: ${point.count}`}>
            <div className={styles.trendBarTrack}>
              <div
                className={styles.trendBarFill}
                style={{ height: `${Math.round((point.count / maxCount) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.trendAxis}>
        <span>{formatShortDate(trend[0].date)}</span>
        <span>{formatShortDate(trend[trend.length - 1].date)}</span>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const dataFetcher = useFetcher<typeof loader>();
  const navigation = useNavigation();

  // Range switching goes through this fetcher rather than useSearchParams/setSearchParams —
  // Shopify Admin's embedded-app shell silently reverts raw History API navigation back to
  // its own last-known URL a few hundred ms after it lands (root-caused for the Requests
  // page, then Reviews/Products — see those pages' own git history). A fetcher re-runs the
  // same loader over a plain request without touching window.history, so there's nothing for
  // the admin shell to fight.
  const data = dataFetcher.data ?? loaderData;
  const { range, reviewAnalytics, requestAnalytics, conversionInsights, aiDigest, canUseAnalytics } = data;

  const isLoading = navigation.state !== "idle" || dataFetcher.state !== "idle";

  const handleRangeChange = (nextRange: AnalyticsDateRange) => {
    dataFetcher.load(`/app/analytics?range=${nextRange}`);
  };

  return (
    <Container as="main">
      <div className={shellStyles.page}>
        <header className={shellStyles.header}>
          <div className={shellStyles.headerContent}>
            <p className={shellStyles.eyebrow}>Imagyn Reviews</p>
            <h1 className={shellStyles.title}>Analytics</h1>
            <p className={shellStyles.subtitle}>How your reviews and review requests are performing.</p>
          </div>
        </header>

        <div className={styles.rangeSegments} role="group" aria-label="Date range">
          {ANALYTICS_DATE_RANGES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.rangeSegment} ${range === option.value ? styles.rangeSegmentActive : ""}`}
              aria-pressed={range === option.value}
              onClick={() => handleRangeChange(option.value)}
              disabled={isLoading}
            >
              {option.label}
            </button>
          ))}
        </div>

        {isLoading ? <p className={styles.feedbackMuted}>Refreshing analytics…</p> : null}

        <Section title="Reviews" description="Volume, rating, and status for reviews created in this range.">
          <div className={styles.summaryGrid}>
            <SummaryCard label="Total reviews" value={formatCount(reviewAnalytics.totalReviews)} />
            <SummaryCard
              label="Average rating"
              value={reviewAnalytics.statusCounts.approved > 0 ? reviewAnalytics.averageRating.toFixed(1) : "—"}
            />
            <SummaryCard label="Approved" value={formatCount(reviewAnalytics.statusCounts.approved)} />
            <SummaryCard label="Pending" value={formatCount(reviewAnalytics.statusCounts.pending)} />
            <SummaryCard label="Rejected" value={formatCount(reviewAnalytics.statusCounts.rejected)} />
          </div>

          <div className={styles.insightsGrid}>
            <Card className={styles.chartCard}>
              <p className={styles.chartTitle}>Reviews over time</p>
              <TrendChart trend={reviewAnalytics.trend} />
            </Card>
            <Card className={styles.chartCard}>
              <p className={styles.chartTitle}>Rating distribution</p>
              {reviewAnalytics.statusCounts.approved === 0 ? (
                <p className={styles.mutedText}>Ratings will appear here once reviews are approved.</p>
              ) : (
                <RatingDistribution ratingCounts={reviewAnalytics.ratingCounts} />
              )}
            </Card>
          </div>
        </Section>

        <Section title="Review requests" description="Volume and conversion for requests created in this range.">
          <div className={styles.summaryGrid}>
            <SummaryCard label="Total requests" value={formatCount(requestAnalytics.totalRequests)} />
            <SummaryCard label="Sent" value={formatCount(requestAnalytics.sent)} />
            <SummaryCard label="Completed" value={formatCount(requestAnalytics.completed)} />
            <SummaryCard label="Completion rate" value={formatPercent(requestAnalytics.completionRate)} />
          </div>

          <Card className={styles.chartCard}>
            <p className={styles.chartTitle}>Requests over time</p>
            <TrendChart trend={requestAnalytics.trend} />
          </Card>
        </Section>

        <Section title="Advanced analytics" description="Deeper conversion insights and AI-generated review themes.">
          {canUseAnalytics && conversionInsights && aiDigest ? (
            <div className={styles.proContent}>
              <div className={styles.summaryGrid}>
                <SummaryCard
                  label="Avg. time to review"
                  value={
                    conversionInsights.averageTimeToConversionHours === null
                      ? "—"
                      : conversionInsights.averageTimeToConversionHours < 24
                        ? `${conversionInsights.averageTimeToConversionHours}h`
                        : `${(conversionInsights.averageTimeToConversionHours / 24).toFixed(1)}d`
                  }
                />
              </div>

              <div className={styles.insightsGrid}>
                <Card className={styles.chartCard}>
                  <p className={styles.chartTitle}>Conversion by source</p>
                  {conversionInsights.bySource.length === 0 ? (
                    <p className={styles.mutedText}>No sent requests in this range yet.</p>
                  ) : (
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Sent</th>
                          <th>Completed</th>
                          <th>Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conversionInsights.bySource.map((row) => (
                          <tr key={row.source}>
                            <td>{row.source === "order" ? "Automatic" : "Manual"}</td>
                            <td>{formatCount(row.sent)}</td>
                            <td>{formatCount(row.completed)}</td>
                            <td>{formatPercent(row.completionRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>

                <Card className={styles.chartCard}>
                  <p className={styles.chartTitle}>Conversion by delay</p>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Delay</th>
                        <th>Sent</th>
                        <th>Completed</th>
                        <th>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conversionInsights.byDelayBucket.map((row) => (
                        <tr key={row.bucket}>
                          <td>{row.bucket}</td>
                          <td>{formatCount(row.sent)}</td>
                          <td>{formatCount(row.completed)}</td>
                          <td>{row.sent > 0 ? formatPercent(row.completionRate) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>

              <Card className={styles.chartCard}>
                <p className={styles.chartTitle}>AI review insights</p>
                {aiDigest.length === 0 ? (
                  <p className={styles.mutedText}>
                    Generate an AI summary from a product page to see it here.
                  </p>
                ) : (
                  <ul className={styles.aiDigestList}>
                    {aiDigest.map((entry) => (
                      <li key={entry.productId} className={styles.aiDigestItem}>
                        <p className={styles.aiDigestProduct}>{entry.productName}</p>
                        <p className={styles.aiDigestRecommendation}>{entry.recommendation}</p>
                        <p className={styles.aiDigestMeta}>
                          Based on {formatCount(entry.reviewCountUsed)} review
                          {entry.reviewCountUsed === 1 ? "" : "s"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          ) : (
            <UpgradePrompt
              feature="Advanced analytics"
              description="Time-to-review, conversion broken down by request source and delay, and an AI-generated digest of what customers say across your catalog."
              benefit="Growth and above include deeper conversion insights and AI review themes, on top of everything in Free analytics."
              requiredPlanName="Growth"
              billingHref="/app/billing"
            />
          )}
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
