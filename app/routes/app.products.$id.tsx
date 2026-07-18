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
import { authenticate } from "../shopify.server";
import { getOrCreateStore } from "../services/store.server";
import { getProductForStore } from "../services/product.server";
import { reviewService } from "../services/review.server";
import shellStyles from "../styles/app.shell.module.css";
import styles from "../styles/app.product-detail.module.css";

type ProductStats = Awaited<ReturnType<typeof reviewService.getProductStats>>;
type ProductReview = Awaited<ReturnType<typeof reviewService.list>>[number];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const productId = params.id ?? "";

  try {
    const store = await getOrCreateStore(session.shop);
    const product = productId ? await getProductForStore(productId, store.id) : null;

    if (!product) {
      return {
        product: null,
        stats: { totalCount: 0, averageRating: 0 } as ProductStats,
        reviews: [] as ProductReview[],
        error: "Product not found.",
      };
    }

    const [stats, reviews] = await Promise.all([
      reviewService.getProductStats(product.id),
      reviewService.list(store.id, product.id),
    ]);

    return {
      product,
      stats,
      reviews,
      error: null as string | null,
    };
  } catch (error) {
    return {
      product: null,
      stats: { totalCount: 0, averageRating: 0 } as ProductStats,
      reviews: [] as ProductReview[],
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

const reviewStatusToneFor = (status: string): "success" | "warning" | "attention" => {
  if (status === "approved") {
    return "success";
  }

  if (status === "rejected") {
    return "attention";
  }

  return "warning";
};

const formatDate = (value: Date | string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));

const renderStars = (rating: number) =>
  Array.from({ length: 5 }, (_, index) => (
    <svg
      key={index}
      viewBox="0 0 24 24"
      className={styles.starIcon}
      aria-hidden="true"
      style={{ opacity: index < rating ? 1 : 0.22 }}
    >
      <path d="M12 2.75l2.84 5.75 6.36.92-4.6 4.48 1.09 6.34L12 17.46l-5.69 3.18 1.09-6.34-4.6-4.48 6.36-.92L12 2.75z" />
    </svg>
  ));

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statItem}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
    </div>
  );
}

export default function ProductDetailPage() {
  const { product, stats, reviews, error } = useLoaderData<typeof loader>();
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
              <RemixLink to={backHref} className={styles.backLinkButton}>
                Back to Products
              </RemixLink>
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
                      <StatItem label="Review count" value={String(stats.totalCount)} />
                      <StatItem
                        label="Average rating"
                        value={stats.totalCount > 0 ? `${stats.averageRating.toFixed(1)} / 5` : "No ratings yet"}
                      />
                      <StatItem label="Created" value={formatDate(product.createdAt)} />
                      {product.shopifyProductId ? (
                        <StatItem label="Last synced" value={formatDate(product.updatedAt)} />
                      ) : null}
                    </dl>
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
                      {reviews.map((review: ProductReview) => (
                        <article key={review.id} className={styles.reviewRow}>
                          <div className={styles.reviewRating} aria-label={`${review.rating ?? 0} out of 5 stars`}>
                            {renderStars(review.rating ?? 0)}
                          </div>
                          <div className={styles.reviewContent}>
                            <div className={styles.reviewHeaderLine}>
                              <span className={styles.reviewTitle}>{review.title ?? "Untitled review"}</span>
                              <Badge tone={reviewStatusToneFor(review.status)}>{formatStatusLabel(review.status)}</Badge>
                            </div>
                            <p className={styles.reviewMeta}>
                              {review.authorName ?? "Anonymous"} • {formatDate(review.createdAt)}
                            </p>
                            {review.body ? <p className={styles.reviewBody}>{review.body}</p> : null}
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
