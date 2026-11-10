// The house stat tile — one number, its label, and optionally one line of real context.
//
// WHY THIS EXISTS
//
// Three stylesheets had grown their own version of this with three different value sizes and
// two different label treatments: app._index.module.css's .kpiCard/.kpiHero (a bordered tile),
// and app.management.module.css's .statRow/.stat (a borderless stat sitting inside a Card),
// used by app.settings.trust and app.settings.rewards. A number is the most-read element on a
// dashboard, so three renderings of it is three answers to "how big is a headline figure in
// this product".
//
// Extracted from .kpiCard/.kpiHero, the most considered of them: tabular figures, a muted 12px
// label beneath rather than above the value, and a tinted surface for a genuine status rather
// than a coloured border rail. `variant="bare"` is the .stat case — same element, no container
// of its own, because it is already inside one.
//
// NOT folded in here, deliberately, because they are different elements rather than different
// renderings of this one:
//   - app.settings.seo.module.css's .metricRow — an INLINE figure (value and label on one
//     baseline), not a tile.
//   - app.product-detail.module.css's .statLabel/.statValue — a definition-list key/value row
//     (<dt>/<dd>, uppercase label, 14px value). A detail row, not a metric.
//
// TONE IS A FACT, NOT A DECORATION
//
// `tone` tints the surface and recolours the value. It must only ever be set from a real
// threshold the merchant could apply themselves — "verified share is above 60%", not "this
// card should look important". Three rules follow from that, and they are the reason this
// component exists rather than a `className`:
//
//  1. There is no "primary" or "brand" tone. A tile is not tinted to draw the eye.
//  2. Tone never carries meaning alone. The label and the number say what is true; the tint
//     only reinforces it, so it still reads correctly in greyscale or to a colourblind
//     merchant.
//  3. "neutral" is the default and by far the commonest. Most numbers are just numbers.
import type { ReactNode } from "react";

import styles from "./metric.module.css";

/** Set only from a real threshold — see this file's header. */
export type MetricTone = "neutral" | "positive" | "attention" | "danger";

export type MetricSize = "default" | "hero";

/**
 * Whether the tile brings its own surface.
 *
 * "card" is the default: a bordered, padded panel that stands on the page background.
 * "bare" has no border, background or padding, for a stat that already sits inside a Card —
 * nesting a bordered tile in a bordered card draws two borders a few pixels apart, which is
 * the single most common way a dashboard starts to look like a stack of boxes.
 */
export type MetricVariant = "card" | "bare";

interface MetricProps {
  /** The number itself. Already formatted by the caller, which owns the units, the locale and
   *  the em-dash it shows when there is genuinely no data yet. */
  value: ReactNode;
  label: ReactNode;
  /**
   * One line of real context beneath the value — "12 published", "of 340 requests".
   *
   * Never a fabricated trend. The services behind these screens do not compute
   * period-over-period comparisons, so "+12% this week" here would be invented; if a real
   * comparison exists, pass it, and if it does not, leave this out.
   */
  sub?: ReactNode;
  tone?: MetricTone;
  /** "hero" is the one or two headline figures at the top of a screen. Everything else is
   *  "default" — a screen where every tile is a hero has no hero. */
  size?: MetricSize;
  /** "bare" for a stat already inside a Card. See MetricVariant. */
  variant?: MetricVariant;
}

// Tone always recolours the VALUE. The card variant additionally tints its surface; the bare
// variant has no surface to tint, so the number carries the whole signal — which is exactly
// what app.management's .statValueSuccess/.statValueWarning/.statValueDanger already did.
const TONE_CLASS: Record<MetricTone, string> = {
  neutral: "",
  positive: styles.tonePositive,
  attention: styles.toneAttention,
  danger: styles.toneDanger,
};

export function Metric({
  value,
  label,
  sub,
  tone = "neutral",
  size = "default",
  variant = "card",
}: MetricProps) {
  return (
    <div
      className={[
        styles.metric,
        variant === "bare" ? styles.bare : "",
        size === "hero" ? styles.hero : "",
        TONE_CLASS[tone],
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* <div>, not <p>, for all three slots. Each is typed ReactNode, so a caller may pass an
          element — and the dashboard does: the "Average rating" tile passes <StarRating/> as
          `sub`, whose root is a <div>. A <div> inside a <p> is invalid HTML, and the browser's
          parser auto-closes the <p> when it reaches it, so the parsed DOM can never match the
          tree React rendered on the server.

          In production that costs a hydration warning. In development it takes the entire
          stylesheet with it: React Router serves all dev CSS as one
          data-react-router-critical-css node, and a failed hydration re-renders from scratch
          without it, leaving the dashboard as unstyled HTML until a manual refresh. Captured
          live on verveonline — "Expected server HTML to contain a matching <div> in <p>", with
          the component stack reading `at StarRating / at p / at Metric`, on a load measured at
          0 CSS rules and body background rgba(0, 0, 0, 0).

          Banner's own subtitle slot reached the same conclusion for the same reason; see the
          comment there. A ReactNode slot does not get wrapped in a <p>. The three classes set
          margin: 0 and nothing in metric.module.css selects `p`, so this renders identically. */}
      <div className={styles.value}>{value}</div>
      {sub ? <div className={styles.sub}>{sub}</div> : null}
      <div className={styles.label}>{label}</div>
    </div>
  );
}

/** The standard row of tiles: as many as fit at a readable width, wrapping rather than
 *  shrinking below it. Exported so a screen does not re-declare the grid each time.
 *
 *  `variant="bare"` widens the gap and lowers the minimum column width to match what
 *  app.management.module.css's .statRow used — borderless stats need more space between them
 *  to read as separate figures, because they have no border doing that job. */
export function MetricRow({ children, variant = "card" }: { children: ReactNode; variant?: MetricVariant }) {
  return <div className={[styles.row, variant === "bare" ? styles.rowBare : ""].filter(Boolean).join(" ")}>{children}</div>;
}
