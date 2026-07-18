import styles from "./star-rating.module.css";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  label?: string;
}

const STAR_PATH = "M12 2.75l2.84 5.75 6.36.92-4.6 4.48 1.09 6.34L12 17.46l-5.69 3.18 1.09-6.34-4.6-4.48 6.36-.92L12 2.75z";

export function StarRating({ value, onChange, size = 18, label }: StarRatingProps) {
  const interactive = Boolean(onChange);

  return (
    <div
      className={styles.row}
      role={interactive ? "radiogroup" : "img"}
      aria-label={label ?? `${value} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const starValue = index + 1;
        const filled = starValue <= value;
        const star = (
          <svg
            viewBox="0 0 24 24"
            className={styles.star}
            aria-hidden="true"
            style={{ width: size, height: size, opacity: filled ? 1 : 0.22 }}
          >
            <path d={STAR_PATH} />
          </svg>
        );

        if (!interactive) {
          return <span key={starValue}>{star}</span>;
        }

        return (
          <button
            key={starValue}
            type="button"
            className={styles.starButton}
            onClick={() => onChange?.(starValue)}
            aria-label={`${starValue} star${starValue === 1 ? "" : "s"}`}
            aria-pressed={filled}
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}
