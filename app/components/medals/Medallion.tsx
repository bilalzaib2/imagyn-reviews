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

type Finish = "pewter" | "silver" | "graphite" | "onyx";

// Real award medals get more precious as the tier climbs (bronze -> silver -> gold, ...) —
// translated into Imagyn's strictly monochrome brand language (no added hue anywhere, per
// docs/08_BRANDING.md) as a lightness progression across four flat tones instead of color.
// Tier 4 ("onyx") deliberately bottoms out at #0d0e0f, the exact near-black used by the brand
// mark itself (public/assets/imagyn-app-logo.svg) — the one place this component intentionally
// echoes the brand mark's own tone rather than inventing a new one. Mirrored exactly in
// extensions/imagyn-review-widgets/assets/medals-showcase.js's own FINISH_BY_TIER — keep
// both in sync if this ever changes.
const FINISH_BY_TIER: Finish[] = ["pewter", "silver", "graphite", "onyx"];

function finishForTier(tier: number): Finish {
  const index = Math.min(Math.max(Math.round(tier), 1), FINISH_BY_TIER.length) - 1;
  return FINISH_BY_TIER[index];
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function Medallion({
  category,
  unlocked,
  tier = 1,
  size = 44,
}: {
  category: AchievementCategory;
  unlocked: boolean;
  /** Which flat tone to render when unlocked — see FINISH_BY_TIER above. Ignored when
   *  locked (locked medals stay a single flat, muted treatment regardless of tier). */
  tier?: number;
  size?: number;
}) {
  const finish = finishForTier(tier);
  const finishClass = styles[`medallion${capitalize(finish)}` as keyof typeof styles];

  const glyphPath = category === "ranking" ? null : GLYPH_BY_CATEGORY[category];

  return (
    <svg
      className={[styles.medallion, unlocked ? styles.medallionUnlocked : styles.medallionLocked, unlocked ? finishClass : ""]
        .filter(Boolean)
        .join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={unlocked ? "Earned medal" : "Locked medal"}
    >
      {/* Flat ring + fill — a restrained, editorial badge, not a rendered 3D object. Tier
          identity comes entirely from these two flat tones (see medallion.module.css). */}
      <circle cx="12" cy="12" r="10.5" className={styles.medallionRing} />
      <circle cx="12" cy="12" r="9" className={styles.medallionFill} />

      {glyphPath ? (
        <path d={glyphPath} className={styles.medallionGlyph} />
      ) : (
        <>
          <circle cx="12" cy="12" r="5.5" className={styles.medallionGlyphStroke} fill="none" />
          <circle cx="12" cy="12" r="2" className={styles.medallionGlyph} />
        </>
      )}

      {/* A tiny, subtle Imagyn signature — three small dots echoing the brand emblem's own
          dot-grid motif (public/assets/imagyn-emblem.svg), tucked at the bottom of the ring.
          Unlocked only; deliberately small enough to read as a maker's mark, never competing
          with the category glyph at the medal's center. */}
      {unlocked ? (
        <g className={styles.medallionMark} aria-hidden="true">
          <circle cx="9.4" cy="19.1" r="0.55" />
          <circle cx="12" cy="19.6" r="0.7" />
          <circle cx="14.6" cy="19.1" r="0.55" />
        </g>
      ) : null}
    </svg>
  );
}
