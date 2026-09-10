import type { CSSProperties } from "react";
import { data, Link, isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { getReviewSiteData } from "../services/reviewSite.server";
import { StarRating } from "../components/reviews/StarRating";
import styles from "../styles/review-site.module.css";

// Public, unauthenticated, shareable "all our reviews" page — a real promotable trust page a
// merchant can link from an email signature, social bio, or ad landing page (distinct from the
// storefront widgets, which only ever render inside the merchant's own theme, and the machine-
// readable feeds under /feeds/*, which are meant for another system to fetch, not a human to
// browse). Real published reviews only, paginated via a real cursor — never a placeholder or
// sample review, even when a store has none yet (see the empty state below).
const formatDate = (value: Date | string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const slug = params.slug;
  if (!slug) {
    throw data({ reason: "not_found" as const }, { status: 404 });
  }

  const cursor = new URL(request.url).searchParams.get("cursor");
  const site = await getReviewSiteData(slug, cursor);

  if (!site) {
    throw data({ reason: "not_found" as const }, { status: 404 });
  }

  return { slug, site };
};

export default function ReviewSitePage() {
  const { slug, site } = useLoaderData<typeof loader>();

  // Global Brand inheritance (Brand Studio) — real CSS custom property overrides, only ever
  // emitted once a merchant has actually saved a configuration (see reviewSite.server.ts's
  // `hasCustomBrand` for exactly why the gate exists: this page's own CSS defaults don't
  // numerically match AppearanceTokens' defaults, so applying tokens unconditionally would
  // re-skin an unconfigured store's page on day one). `--brand-text` is only set when the
  // merchant chose a fixed text color — null means "inherit the page's own default", so it's
  // simply omitted, never forced to a fabricated value.
  const brandStyle: CSSProperties = site.hasCustomBrand
    ? {
        ...({
          "--brand-accent": site.appearance.colors.starColor,
          "--brand-border": site.appearance.colors.borderColor,
          "--brand-surface": site.appearance.colors.surfaceColor,
          "--brand-radius": `${site.appearance.corners.radius}px`,
          ...(site.appearance.colors.textColor ? { "--brand-text": site.appearance.colors.textColor } : {}),
        } as CSSProperties),
      }
    : {};

  return (
    <div className={styles.page} style={brandStyle}>
      <div className={styles.container}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Customer Reviews</p>
          <h1 className={styles.storeName}>{site.storeName}</h1>
          {site.publishedReviews > 0 ? (
            <div className={styles.summary}>
              <div className={styles.summaryHero}>
                <span className={styles.averageRating}>{site.averageRating.toFixed(1)}</span>
                <div className={styles.summaryHeroMeta}>
                  <StarRating value={Math.round(site.averageRating)} size={20} />
                  <span className={styles.reviewCount}>
                    Based on {site.publishedReviews} review{site.publishedReviews === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className={styles.distribution}>
                {([5, 4, 3, 2, 1] as const).map((value) => {
                  const count = site.ratingCounts[value];
                  const percent =
                    site.publishedReviews > 0 ? Math.round((count / site.publishedReviews) * 100) : 0;
                  return (
                    <div key={value} className={styles.distributionRow}>
                      <span className={styles.distributionLabel}>{value}</span>
                      <span className={styles.distributionTrack}>
                        <span className={styles.distributionFill} style={{ width: `${percent}%` }} />
                      </span>
                      <span className={styles.distributionCount}>{count}</span>
                    </div>
                  );
                })}
              </div>

              {site.storeAiSummary ? (
                <div className={styles.aiSummary}>
                  <p className={styles.aiSummaryLabel}>AI Review Summary</p>
                  <p className={styles.aiSummaryText}>{site.storeAiSummary.summary}</p>
                  <p className={styles.aiSummaryMeta}>
                    Based on {site.storeAiSummary.reviewCountUsed} approved review
                    {site.storeAiSummary.reviewCountUsed === 1 ? "" : "s"}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </header>

        {site.reviews.length === 0 ? (
          <p className={styles.emptyState}>No reviews have been published yet — check back soon.</p>
        ) : (
          <>
            <div className={styles.reviewList}>
              {site.reviews.map((review) => (
                <article key={review.id} className={styles.reviewCard}>
                  <div className={styles.reviewCardHeader}>
                    <span className={styles.reviewerName}>{review.reviewerName}</span>
                    <StarRating value={review.rating} size={16} />
                  </div>
                  <p className={styles.reviewMeta}>
                    {review.verifiedPurchase ? <span className={styles.verifiedBadge}>Verified Buyer</span> : null}
                    <span>{formatDate(review.createdAt)}</span>
                  </p>
                  {review.title ? <h2 className={styles.reviewTitle}>{review.title}</h2> : null}
                  <p className={styles.reviewContent}>{review.content}</p>
                  {review.product ? <span className={styles.productName}>{review.product.name}</span> : null}
                </article>
              ))}
            </div>

            {site.hasMore && site.nextCursor ? (
              <div className={styles.pagination}>
                <Link to={`/reviews-site/${slug}?cursor=${site.nextCursor}`} className={styles.loadMoreLink}>
                  Load more reviews
                </Link>
              </div>
            ) : null}
          </>
        )}

        <p className={styles.footer}>Reviews collected and verified by Imagyn Reviews.</p>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <p className={styles.emptyState}>This review page couldn&apos;t be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <p className={styles.emptyState}>Something went wrong loading this page.</p>
      </div>
    </div>
  );
}
