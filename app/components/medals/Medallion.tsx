import { useId } from "react";
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
// docs/08_BRANDING.md) as a lightness progression across four brushed-metal finishes instead
// of color. Tier 4 ("onyx") deliberately bottoms out at #0d0e0f, the exact near-black used
// by the brand mark itself (public/assets/imagyn-app-logo.svg), a shade darker than the
// app's own --color-text (#111111) — the one place this component intentionally echoes the
// brand mark's own tone rather than inventing a new one. Mirrored exactly in
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
  size = 60,
}: {
  category: AchievementCategory;
  unlocked: boolean;
  /** Which brushed-metal finish to render when unlocked — see FINISH_BY_TIER above. Ignored
   *  when locked (locked medals stay a single flat, muted treatment regardless of tier). */
  tier?: number;
  size?: number;
}) {
  // Unique per instance so multiple medals rendered on one page (the Medals grid, or a
  // future storefront showcase) never collide on the same gradient id.
  const uid = useId().replace(/[:]/g, "");
  const faceId = `medallion-face-${uid}`;
  const rimId = `medallion-rim-${uid}`;
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
      {unlocked ? (
        <defs>
          {/* Lit from above-left, like every reference physical medal — a flat single-hue
              disc would read as a sticker, not an object. */}
          <radialGradient id={faceId} cx="36%" cy="28%" r="80%">
            <stop offset="0%" className={styles.faceStopLight} />
            <stop offset="100%" className={styles.faceStopDark} />
          </radialGradient>
          <linearGradient id={rimId} x1="15%" y1="5%" x2="90%" y2="100%">
            <stop offset="0%" className={styles.rimStopLight} />
            <stop offset="100%" className={styles.rimStopDark} />
          </linearGradient>
        </defs>
      ) : null}

      {/* Rim — the beveled edge. Unlocked gets the diagonal metal gradient; locked stays the
          flat muted stroke, unchanged from the previous design. */}
      <circle cx="12" cy="12" r="10.5" className={styles.medallionRing} stroke={unlocked ? `url(#${rimId})` : undefined} />
      <circle cx="12" cy="12" r="9" className={styles.medallionFill} fill={unlocked ? `url(#${faceId})` : undefined} />

      {/* A single engraved groove near the rim — the one deliberate "this has a raised face,
          not a flat sticker" cue kept from the original design, now finish-aware (a dark
          line reads as a groove on a light finish; a light line reads the same way on a
          dark one). */}
      {unlocked ? <circle cx="12" cy="12" r="7.4" className={styles.medallionEngraveRing} fill="none" /> : null}

      {/* Emboss, unlocked only: a dark copy (multiply) offset down-right, a light copy
          (screen) offset up-left, and the true-position base shape between them. Multiply/
          screen blending means this reads as "carved into this exact metal" regardless of
          which finish is active, without needing per-finish shadow/highlight colors or any
          SVG filter — three flat shapes stay crisp and cheap even rendered a dozen times on
          one page (the Medals grid) or many times at very small sizes (a future storefront
          showcase). Locked medals skip all of this and render the flat single-tone glyph
          exactly as before. */}
      {unlocked ? (
        glyphPath ? (
          <>
            <path d={glyphPath} transform="translate(0.35 0.45)" className={styles.medallionGlyphShadow} />
            <path d={glyphPath} transform="translate(-0.25 -0.3)" className={styles.medallionGlyphHighlight} />
            <path d={glyphPath} className={styles.medallionGlyphBase} />
          </>
        ) : (
          <>
            <circle cx="12.35" cy="12.45" r="5.5" className={styles.medallionGlyphStrokeShadow} fill="none" />
            <circle cx="11.75" cy="11.7" r="5.5" className={styles.medallionGlyphStrokeHighlight} fill="none" />
            <circle cx="12" cy="12" r="5.5" className={styles.medallionGlyphStrokeBase} fill="none" />
            <circle cx="12.35" cy="12.45" r="2" className={styles.medallionGlyphShadow} />
            <circle cx="11.75" cy="11.7" r="2" className={styles.medallionGlyphHighlight} />
            <circle cx="12" cy="12" r="2" className={styles.medallionGlyphBase} />
          </>
        )
      ) : glyphPath ? (
        <path d={glyphPath} className={styles.medallionGlyph} />
      ) : (
        <>
          <circle cx="12" cy="12" r="5.5" className={styles.medallionGlyphStroke} fill="none" />
          <circle cx="12" cy="12" r="2" className={styles.medallionGlyph} />
        </>
      )}
    </svg>
  );
}
