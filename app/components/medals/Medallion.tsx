import type { AchievementCategory } from "../../services/achievements.shared";
import styles from "./medallion.module.css";

// An original Imagyn mark, not a reproduction of any third party's badge artwork — a plain
// ringed circle with one small, category-specific glyph at its center, built entirely from
// SVG primitives. Locked medals render in the same shape at reduced opacity/desaturated,
// rather than a different (and potentially more "finished-looking") design, so a merchant
// never mistakes a locked medal for a broken one.
const GLYPH_BY_CATEGORY: Record<AchievementCategory, string> = {
  // Checkmark — verified.
  verified: "M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z",
  // Upward peak — a milestone/record.
  milestone: "M4 17h16l-5-9-3.5 6-2-3z",
  // Simple shield — trust.
  trust: "M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6z",
  // Concentric rings — a ranking among peers.
  ranking: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  // Rising chevron — trending.
  trending: "M4 16l6-6 4 4 6-7",
};

export function Medallion({
  category,
  unlocked,
  size = 56,
}: {
  category: AchievementCategory;
  unlocked: boolean;
  size?: number;
}) {
  return (
    <svg
      className={`${styles.medallion} ${unlocked ? styles.medallionUnlocked : styles.medallionLocked}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={unlocked ? "Earned medal" : "Locked medal"}
    >
      <circle cx="12" cy="12" r="10.5" className={styles.medallionRing} />
      <circle cx="12" cy="12" r="9" className={styles.medallionFill} />
      {category === "ranking" ? (
        <>
          <circle cx="12" cy="12" r="5.5" className={styles.medallionGlyphStroke} fill="none" />
          <circle cx="12" cy="12" r="2" className={styles.medallionGlyph} />
        </>
      ) : (
        <path d={GLYPH_BY_CATEGORY[category]} className={styles.medallionGlyph} />
      )}
    </svg>
  );
}
