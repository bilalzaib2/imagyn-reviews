import { useEffect, useState } from "react";
import {
  Link as RemixLink,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  EmptyState,
  Frame,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  Toast,
} from "@shopify/polaris";

import { Button } from "../components/ui/Button";
import { Container } from "../components/ui/Container";
import { LinkButton } from "../components/ui/LinkButton";
import { ReviewStatusBadge } from "../components/reviews/ReviewStatusBadge";
import { StarRating } from "../components/reviews/StarRating";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProductForStore } from "../services/product.server";
import { getProductReviews, type ReviewWithProduct } from "../services/review.server";
import { getAiSummary, regenerateAiSummary, type ProductAiSummaryRecord } from "../services/aiSummary.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.product-detail.module.css";

const REVIEW_LIST_LIMIT = 50;

type ActionData = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const productId = params.id ?? "";

  try {
    const store = await getOrCreateStore(session.shop);
    const product = productId ? await getProductForStore(productId, store.id) : null;

    if (!product) {
      return {
        product: null,
        reviews: [] as ReviewWithProduct[],
        reviewsTotalCount: 0,
        aiSummary: null as ProductAiSummaryRecord | null,
        error: "Product not found.",
      };
    }

    const [reviewResult, aiSummary] = await Promise.all([
      getProductReviews(product.id, { limit: REVIEW_LIST_LIMIT }),
      getAiSummary(product.id),
    ]);

    return {
      product,
      reviews: reviewResult.reviews,
      reviewsTotalCount: reviewResult.totalCount,
      aiSummary,
      error: null as string | null,
    };
  } catch (error) {
    return {
      product: null,
      reviews: [] as ReviewWithProduct[],
      reviewsTotalCount: 0,
      aiSummary: null as ProductAiSummaryRecord | null,
      error: error instanceof Error ? error.message : "Unable to load product.",
    };
  }
};

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionData> => {
  await authenticate.admin(request);

  const productId = params.id ?? "";
  const formData = await request.formData();
  const intent = String(formData.get("_intent") || "");

  if (intent !== "regenerateAiSummary") {
    return { ok: false, error: "Unsupported action." };
  }

  if (!productId) {
    return { ok: false, error: "Product ID is required." };
  }

  try {
    await regenerateAiSummary(productId);
    return { ok: true, message: "AI Review Summary regenerated." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to regenerate the AI summary.",
    };
  }
};

function formatRelativeTime(value: Date | string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

const formatStatusLabel = (status: string | null) => {
  if (!status) {
    return "Unknown";
  }

  const normalized = status.toLowerCase();
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
};

const statusToneFor = (status: string | null): "success" | "info" | "attention" => {
  const normalized = status?.toLowerCase() ?? "";

  if (normalized === "active") {
    return "success";
  }

  if (normalized === "archived") {
    return "attention";
  }

  return "info";
};

const formatDate = (value: Date | string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statItem}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}

function RatingBreakdown({
  totalReviews,
  counts,
}: {
  totalReviews: number;
  counts: [number, number, number, number, number];
}) {
  if (totalReviews === 0) {
    return null;
  }

  return (
    <div className={styles.ratingBreakdown}>
      {([5, 4, 3, 2, 1] as const).map((star, index) => {
        const count = counts[index];
        const percent = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;

        return (
          <div key={star} className={styles.ratingBreakdownRow}>
            <span className={styles.ratingBreakdownLabel}>{star}★</span>
            <div className={styles.ratingBreakdownTrack}>
              <div className={styles.ratingBreakdownFill} style={{ width: `${percent}%` }} />
            </div>
            <span className={styles.ratingBreakdownCount}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ProductDetailPage() {
  const { product, reviews, reviewsTotalCount, aiSummary, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  const fetcher = useFetcher<ActionData>();
  const isLoading = navigation.state !== "idle";
  const isRegenerating = fetcher.state !== "idle";
  const [toastState, setToastState] = useState<{ content: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!fetcher.data) {
      return;
    }

    setToastState(
      fetcher.data.ok
        ? { content: fetcher.data.message || "AI Review Summary regenerated." }
        : { content: fetcher.data.error || "Unable to regenerate the AI summary.", error: true },
    );
  }, [fetcher.data]);

  const backHref = `/app/products${location.search}`;

  const handleRegenerate = () => {
    if (!product) return;
    const formData = new FormData();
    formData.append("_intent", "regenerateAiSummary");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
    <Container as="main">
      <div className={`${shellStyles.page} ${styles.page}`}>
        <header className={`${shellStyles.header} ${styles.header}`}>
          <div className={shellStyles.headerContent}>
            <p className={`${shellStyles.eyebrow} ${styles.eyebrow}`}>Imagyn Reviews</p>
            <h1 className={`${shellStyles.title} ${styles.title}`}>
              {product ? product.name : "Product"}
            </h1>
            <p className={`${shellStyles.subtitle} ${styles.subtitle}`}>
              Product overview and connected reviews.
            </p>
          </div>
          <div className={styles.headerActions}>
            <LinkButton to={backHref}>Back to Products</LinkButton>
          </div>
        </header>

        {isLoading ? (
          <Card>
            <div className={styles.skeletonBlock}>
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={6} />
            </div>
          </Card>
        ) : error || !product ? (
          <Card>
            <div className={styles.errorState}>
              <Banner tone="critical">{error ?? "Product not found."}</Banner>
              <EmptyState
                heading="This product isn't available"
                action={{ content: "Back to Products", url: backHref }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>It may have been removed, or you may not have access to it.</p>
              </EmptyState>
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <div className={styles.productLayout}>
                {product.featuredImage ? (
                  <img
                    className={styles.productImage}
                    src={product.featuredImage}
                    alt={product.name}
                    loading="lazy"
                  />
                ) : (
                  <div className={styles.productImagePlaceholder} aria-hidden="true" />
                )}

                <div className={styles.productInfo}>
                  <div className={styles.productTitleRow}>
                    <Text as="h2" variant="headingLg">
                      {product.name}
                    </Text>
                    <Badge tone={statusToneFor(product.status)}>{formatStatusLabel(product.status)}</Badge>
                  </div>

                  <dl className={styles.statGrid}>
                    <StatItem label="Vendor" value={product.vendor || "—"} />
                    <StatItem label="Product type" value={product.productType || "—"} />
                    <StatItem
                      label="Average rating"
                      value={product.totalReviews > 0 ? `${product.averageRating.toFixed(1)} / 5` : "No ratings yet"}
                    />
                    <StatItem label="Total reviews" value={String(product.totalReviews)} />
                    <StatItem label="Created" value={formatDate(product.createdAt)} />
                    <StatItem label="Last updated" value={formatDate(product.updatedAt)} />
                    {product.lastSyncedAt ? (
                      <StatItem label="Last synced" value={formatDate(product.lastSyncedAt)} />
                    ) : null}
                  </dl>

                  <RatingBreakdown
                    totalReviews={product.totalReviews}
                    counts={[
                      product.rating5Count,
                      product.rating4Count,
                      product.rating3Count,
                      product.rating2Count,
                      product.rating1Count,
                    ]}
                  />
                </div>
              </div>
            </Card>

            <Card>
              <BlockStack gap="400">
                <div className={styles.reviewsHeader}>
                  <Text as="h2" variant="headingMd">
                    ✨ AI Review Summary
                  </Text>
                  <Button type="button" onClick={handleRegenerate} disabled={isRegenerating}>
                    {isRegenerating ? "Regenerating…" : "Regenerate AI Summary"}
                  </Button>
                </div>

                {isRegenerating ? (
                  <div className={styles.aiSummarySkeleton} aria-hidden="true">
                    <SkeletonBodyText lines={3} />
                  </div>
                ) : aiSummary ? (
                  <div className={styles.aiSummaryBlock}>
                    <p className={styles.aiSummaryText}>{aiSummary.summary}</p>

                    {aiSummary.positives.length > 0 ? (
                      <div className={styles.aiSummaryGroup}>
                        <span className={styles.aiSummaryGroupLabel}>Customers love</span>
                        <ul className={styles.aiSummaryList}>
                          {aiSummary.positives.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {aiSummary.negatives.length > 0 ? (
                      <div className={styles.aiSummaryGroup}>
                        <span className={styles.aiSummaryGroupLabel}>Common complaints</span>
                        <ul className={styles.aiSummaryList}>
                          {aiSummary.negatives.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {aiSummary.recommendation ? (
                      <p className={styles.aiSummaryRecommendation}>
                        <span className={styles.aiSummaryGroupLabel}>Recommended for</span> {aiSummary.recommendation}
                      </p>
                    ) : null}

                    <dl className={styles.aiSummaryMeta}>
                      <div className={styles.aiSummaryMetaItem}>
                        <dt>Generated</dt>
                        <dd>{formatRelativeTime(aiSummary.generatedAt)}</dd>
                      </div>
                      <div className={styles.aiSummaryMetaItem}>
                        <dt>Reviews analyzed</dt>
                        <dd>{aiSummary.reviewCountUsed}</dd>
                      </div>
                      <div className={styles.aiSummaryMetaItem}>
                        <dt>Model</dt>
                        <dd>{aiSummary.modelUsed}</dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <p className={styles.aiSummaryEmpty}>
                    No AI summary has been generated yet. Click "Regenerate AI Summary" once this product has
                    approved reviews.
                  </p>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <div className={styles.reviewsHeader}>
                  <Text as="h2" variant="headingMd">
                    Reviews
                  </Text>
                  <RemixLink
                    to={`/app/reviews?product=${encodeURIComponent(product.name)}`}
                    className={styles.reviewsLink}
                  >
                    View all in Reviews
                  </RemixLink>
                </div>

                {reviews.length === 0 ? (
                  <EmptyState
                    heading="Your first review will appear here."
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Once a customer leaves feedback on this product, it shows up in this space.</p>
                  </EmptyState>
                ) : (
                  <div className={styles.reviewList}>
                    {reviewsTotalCount > reviews.length ? (
                      <p className={styles.reviewListHint}>
                        Showing the {reviews.length} most recent of {reviewsTotalCount} reviews.
                      </p>
                    ) : null}
                    {reviews.map((review) => (
                      <article key={review.id} className={styles.reviewRow}>
                        <div className={styles.reviewRating} aria-label={`${review.rating} out of 5 stars`}>
                          <StarRating value={review.rating} />
                        </div>
                        <div className={styles.reviewContent}>
                          <div className={styles.reviewHeaderLine}>
                            <span className={styles.reviewTitle}>{review.title ?? "Untitled review"}</span>
                            <ReviewStatusBadge status={review.status} />
                          </div>
                          <p className={styles.reviewMeta}>
                            {review.reviewerName} • {formatDate(review.createdAt)}
                          </p>
                          {review.content ? <p className={styles.reviewBody}>{review.content}</p> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </BlockStack>
            </Card>
          </>
        )}
      </div>
    </Container>
    <Frame>
      {toastState ? (
        <Toast content={toastState.content} error={toastState.error} onDismiss={() => setToastState(null)} />
      ) : null}
    </Frame>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
