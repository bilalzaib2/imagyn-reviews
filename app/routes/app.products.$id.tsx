import { Link as RemixLink, useLoaderData, useLocation, useNavigation, useRouteError } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Card,
  EmptyState,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { Container } from "../components/ui/Container";
import { LinkButton } from "../components/ui/LinkButton";
import { ReviewStatusBadge } from "../components/reviews/ReviewStatusBadge";
import { StarRating } from "../components/reviews/StarRating";
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProductForStore } from "../services/product.server";
import { getProductReviews, type ReviewWithProduct } from "../services/review.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.product-detail.module.css";

const REVIEW_LIST_LIMIT = 50;

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
        error: "Product not found.",
      };
    }

    const reviewResult = await getProductReviews(product.id, { limit: REVIEW_LIST_LIMIT });

    return {
      product,
      reviews: reviewResult.reviews,
      reviewsTotalCount: reviewResult.totalCount,
      error: null as string | null,
    };
  } catch (error) {
    return {
      product: null,
      reviews: [] as ReviewWithProduct[],
      reviewsTotalCount: 0,
      error: error instanceof Error ? error.message : "Unable to load product.",
    };
  }
};

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
  const { product, reviews, reviewsTotalCount, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  const isLoading = navigation.state !== "idle";

  const backHref = `/app/products${location.search}`;

  return (
    <PolarisAppProvider i18n={enTranslations}>
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
                      <StatItem label="Review count" value={String(product.totalReviews)} />
                      <StatItem
                        label="Average rating"
                        value={product.totalReviews > 0 ? `${product.averageRating.toFixed(1)} / 5` : "No ratings yet"}
                      />
                      <StatItem label="Created" value={formatDate(product.createdAt)} />
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
                      heading="No reviews yet"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>Reviews for this product will appear here once customers start submitting them.</p>
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
    </PolarisAppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
