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

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.storeName}>{site.storeName}</h1>
          {site.publishedReviews > 0 ? (
            <div className={styles.summaryRow}>
              <StarRating value={Math.round(site.averageRating)} size={22} />
              <span className={styles.averageRating}>{site.averageRating.toFixed(1)}</span>
              <span className={styles.reviewCount}>
                {site.publishedReviews} review{site.publishedReviews === 1 ? "" : "s"}
              </span>
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
