import type { CSSProperties } from "react";

import type { CarouselSettings } from "../../services/carouselSettings.shared";
import styles from "./carousel-preview.module.css";

export interface PreviewReview {
  id: string;
  title: string;
  body: string;
  rating: number;
  reviewerName: string;
  date: string;
  productName: string;
  verified: boolean;
  images: string[];
  hasVideo: boolean;
}

/**
 * The dashboard's rendering of one carousel card.
 *
 * It deliberately reads every visual value from the same `--imagyn-carousel-*` custom
 * properties the storefront stylesheet consumes (set once on the preview stage by the editor),
 * rather than from the settings object directly. That is the mechanism behind requirement 9:
 * there is one set of numbers and one set of names, so the preview cannot drift from the
 * storefront by accident — only by someone changing one stylesheet and not the other, which
 * the shared variable names make obvious.
 *
 * The markup mirrors review-carousel.js's renderSlide element-for-element and class-for-class.
 */
export function CarouselPreviewCard({ review, settings }: { review: PreviewReview; settings: CarouselSettings }) {
  const showImage =
    settings.showMedia &&
    settings.imageVisibility !== "never" &&
    (settings.imageVisibility === "always" || review.images.length > 0);

  const imageSrc = review.images[0];
  const isBackground = settings.imagePosition === "background";
  const isSide = settings.imagePosition === "left" || settings.imagePosition === "right";

  const media = showImage ? (
    <div className={`${styles.media} ${settings.imageHoverZoom ? styles.mediaZoom : ""}`} data-imagyn-carousel-media>
      {imageSrc ? (
        // Lazy by default: a carousel below the fold should never block a storefront's LCP,
        // and the same attribute is set by the storefront renderer.
        <img src={imageSrc} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className={styles.mediaEmpty} aria-hidden="true" />
      )}
      {review.hasVideo ? <span className={styles.videoBadge} aria-hidden="true" /> : null}
      {review.images.length > 1 ? (
        <span className={styles.mediaCount} aria-hidden="true">
          +{review.images.length - 1}
        </span>
      ) : null}
    </div>
  ) : null;

  const body = (
    <div className={styles.body}>
      {settings.showRating ? (
        <div className={styles.stars} aria-label={`${review.rating} out of 5`}>
          {[1, 2, 3, 4, 5].map((star) => (
            <span key={star} className={star <= review.rating ? styles.starOn : styles.starOff} aria-hidden="true">
              ★
            </span>
          ))}
        </div>
      ) : null}

      {settings.showTitle && review.title ? <p className={styles.title}>{review.title}</p> : null}
      {settings.showBody ? <p className={styles.text}>{review.body}</p> : null}

      {settings.showBody && settings.textDisplay === "truncate" && settings.readMore ? (
        <button type="button" className={styles.readMore}>
          Read more
        </button>
      ) : null}

      {settings.showReviewerName || settings.showVerifiedBadge || settings.showDate ? (
        <p className={styles.meta}>
          {settings.showReviewerName ? <span className={styles.name}>{review.reviewerName}</span> : null}
          {settings.showVerifiedBadge && review.verified ? (
            <span className={styles.verified}>
              {settings.verifiedBadgeStyle !== "text" ? <span aria-hidden="true">✓</span> : null}
              {settings.verifiedBadgeStyle !== "icon" ? <span>Verified</span> : null}
            </span>
          ) : null}
          {settings.showDate ? <span className={styles.date}>{review.date}</span> : null}
        </p>
      ) : null}

      {settings.showProductName ? (
        <p className={styles.product}>
          {settings.showProductImage ? <span className={styles.productThumb} aria-hidden="true" /> : null}
          <span>{review.productName}</span>
        </p>
      ) : null}
    </div>
  );

  return (
    <article
      className={[
        styles.card,
        isBackground && showImage ? styles.cardBackground : "",
        isSide ? styles.cardSide : "",
        settings.imagePosition === "right" ? styles.cardSideReverse : "",
        settings.equalHeight ? styles.cardEqual : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--imagyn-preview-order": settings.imagePosition === "below" ? 1 : 0 } as CSSProperties}
    >
      {isBackground && showImage ? (
        <>
          {media}
          <div className={styles.overlay}>{body}</div>
        </>
      ) : settings.imagePosition === "below" ? (
        <>
          {body}
          {media}
        </>
      ) : (
        <>
          {media}
          {body}
        </>
      )}
    </article>
  );
}
