import { useState } from "react";
import { useLoaderData } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Container } from "../components/ui/Container";
import { Section } from "../components/ui/Section";
import { reviewService } from "../services/review.server";
import styles from "../styles/app.reviews.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const reviews = await reviewService.list();

  return { reviews };
};

export default function ReviewsPage() {
  const { reviews } = useLoaderData<typeof loader>();
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const selectedReview = reviews.find((review: { id: string }) => review.id === selectedReviewId) ?? null;

  const renderStars = (rating: number) =>
    Array.from({ length: 5 }, (_, index) => (
      <svg
        key={index}
        viewBox="0 0 24 24"
        className={styles.starIcon}
        aria-hidden="true"
        style={{ opacity: index < rating ? 1 : 0.25 }}
      >
        <path d="M12 2.75l2.84 5.75 6.36.92-4.6 4.48 1.09 6.34L12 17.46l-5.69 3.18 1.09-6.34-4.6-4.48 6.36-.92L12 2.75z" />
      </svg>
    ));

  return (
    <Container as="main">
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <p className={styles.eyebrow}>Imagyn Reviews</p>
            <h1 className={styles.title}>Reviews</h1>
            <p className={styles.subtitle}>
              Customer feedback and product sentiment.
            </p>
          </div>
        </header>

        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search reviews"
              aria-label="Search reviews"
            />
          </label>
        </div>

        <Section
          title="Recent reviews"
          description="Customer feedback will appear here once reviews are collected."
        >
          <div className={styles.splitLayout}>
            <div className={styles.listColumn}>
              {reviews.length === 0 ? (
                <div className={styles.emptyState}>
                  <h2 className={styles.emptyStateTitle}>No reviews yet</h2>
                  <p className={styles.emptyStateText}>
                    Reviews will appear here as customers share their experiences.
                  </p>
                </div>
              ) : (
                <div className={styles.list}>
                  {reviews.map((review: {
                    id: string;
                    rating: number | null;
                    title: string | null;
                    authorName: string | null;
                    body: string | null;
                    createdAt: Date;
                    product?: { name: string | null } | null;
                  }) => {
                    const isSelected = review.id === selectedReviewId;
                    const rating = review.rating ?? 0;
                    const reviewTitle = review.title ?? "Untitled review";
                    const customerName = review.authorName ?? "Anonymous";
                    const productName = review.product?.name ?? "Unassigned product";
                    const reviewDate = new Intl.DateTimeFormat("en", {
                      month: "short",
                      day: "numeric",
                    }).format(review.createdAt);

                    return (
                      <article
                        key={review.id}
                        className={`${styles.reviewRow} ${isSelected ? styles.reviewRowSelected : ""}`}
                        onClick={() => setSelectedReviewId(review.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedReviewId(review.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className={styles.reviewMain}>
                          <div className={styles.rating} aria-label={`${rating} out of 5 stars`}>
                            {renderStars(rating)}
                          </div>
                          <div className={styles.reviewContent}>
                            <h2 className={styles.reviewTitle}>{reviewTitle}</h2>
                            <p className={styles.reviewMeta}>
                              {customerName} • {productName}
                            </p>
                          </div>
                        </div>
                        <p className={styles.reviewDate}>{reviewDate}</p>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedReview ? (
              <aside className={styles.detailPanel} aria-label="Review details">
                <div className={styles.detailHeader}>
                  <p className={styles.detailEyebrow}>Review</p>
                  <h2 className={styles.detailTitle}>{selectedReview.title ?? "Untitled review"}</h2>
                </div>

                <p className={styles.detailText}>
                  {selectedReview.body ?? "No review text has been provided yet."}
                </p>

                <dl className={styles.detailMetaList}>
                  <div className={styles.detailMetaItem}>
                    <dt className={styles.detailLabel}>Customer</dt>
                    <dd className={styles.detailValue}>{selectedReview.authorName ?? "Anonymous"}</dd>
                  </div>
                  <div className={styles.detailMetaItem}>
                    <dt className={styles.detailLabel}>Product</dt>
                    <dd className={styles.detailValue}>{selectedReview.product?.name ?? "Unassigned product"}</dd>
                  </div>
                  <div className={styles.detailMetaItem}>
                    <dt className={styles.detailLabel}>Rating</dt>
                    <dd className={styles.detailValue}>{selectedReview.rating ?? 0} / 5</dd>
                  </div>
                </dl>
              </aside>
            ) : null}
          </div>
        </Section>
      </div>
    </Container>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
