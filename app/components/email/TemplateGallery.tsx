// Email Studio's template gallery — the five shipped visual directions, shown as something a
// merchant can look at rather than a dropdown of adjectives.
//
// WHY THE THUMBNAILS ARE DRAWN RATHER THAN RENDERED
//
// Each card shows a small abstraction of the email: a logo mark, a heading bar, body lines, a
// product block where the preset leads with one, and a real CTA pill. It is drawn from the
// preset's OWN presentation values, passed down as CSS custom properties — the accent colour,
// corner radius, button fill/outline, button alignment, relative measure and vertical rhythm
// on a card are the same values the renderer will use.
//
// The alternative — rendering five real emails server-side and showing them in five iframes —
// would be more faithful and much worse: five full React Email renders plus five iframes on
// first paint of a page whose actual job is the editor, all to populate a control the merchant
// interacts with once. The live preview pane next to this gallery already shows the real,
// exact email the moment a style is applied, which is where fidelity belongs.
//
// Nothing here persists anything. Choosing a style edits the in-memory draft, exactly like
// typing in a field; the existing debounced preview re-renders, and the merchant saves or
// walks away.
import type { CSSProperties } from "react";

import {
  EMAIL_TEMPLATE_PRESETS,
  type EmailTemplatePreset,
  type EmailTemplatePresetId,
} from "../../services/emailTemplatePresets";
import { CONTENT_WIDTH_RANGE } from "../../services/email.shared";
import styles from "./template-gallery.module.css";

interface TemplateGalleryProps {
  /** Which preset the current draft matches, or null once it has been edited away from all
   *  of them. Drives the "Current" marker only — this component owns no state. */
  activePresetId: EmailTemplatePresetId | null;
  onApply: (presetId: EmailTemplatePresetId) => void;
  /** Whether the merchant's own accent and button-label colours survive an apply. Owned by
   *  the route so it sits next to the rest of the draft controls. */
  preserveColors: boolean;
  onPreserveColorsChange: (value: boolean) => void;
  disabled?: boolean;
}

/** The thumbnail's section running order, derived from the preset so a card can never show a
 *  different composition from the one applying it produces. Only the blocks the thumbnail
 *  actually draws are listed; the compliance footer is not a merchant-visible section. */
function thumbnailBlocks(preset: EmailTemplatePreset): readonly string[] {
  const order = preset.sectionOrder ?? ["logo", "storeName", "heading", "body", "product", "button", "closing"];
  return order.filter((id) => id === "logo" || id === "heading" || id === "body" || id === "button" || (id === "product" && preset.showProduct === true));
}

/** Maps the preset's bounded values onto the custom properties the stylesheet reads. Kept in
 *  one function so the mapping is auditable in a single place. */
function thumbnailStyle(preset: EmailTemplatePreset): CSSProperties {
  const { presentation } = preset;

  // The measure, expressed as a fraction of the widest offered width, so a 480px email reads
  // as visibly narrower on the card than a 640px one — the single most recognisable
  // difference between these five in a real inbox.
  const measure = presentation.contentWidth / CONTENT_WIDTH_RANGE.max;

  const headingHeight = presentation.headingSize === "large" ? 10 : presentation.headingSize === "small" ? 6 : 8;
  const bodyHeight = presentation.bodySize === "large" ? 5 : presentation.bodySize === "small" ? 3 : 4;
  const rhythm = presentation.density === "relaxed" ? 10 : presentation.density === "compact" ? 5 : 7;

  return {
    "--thumb-measure": `${Math.round(measure * 100)}%`,
    "--thumb-accent": presentation.accentColor,
    "--thumb-button-label": presentation.buttonTextColor,
    // Scaled down with the card, so a 0px-radius Editorial button reads as genuinely square
    // and a 12px Modern one as genuinely soft.
    "--thumb-radius": `${Math.round(presentation.cornerRadius / 2)}px`,
    "--thumb-heading-height": `${headingHeight}px`,
    "--thumb-body-height": `${bodyHeight}px`,
    "--thumb-rhythm": `${rhythm}px`,
    "--thumb-align": presentation.buttonAlign === "center" ? "center" : "flex-start",
  } as CSSProperties;
}

function Thumbnail({ preset }: { preset: EmailTemplatePreset }) {
  const isSerif = preset.presentation.fontFamily === "serif";
  const isOutline = preset.presentation.buttonStyle === "outline";

  return (
    // Purely decorative: every fact this conveys is also in the card's name, description and
    // trait list, so a screen reader gains nothing from the bars and loses a sentence of noise.
    <div className={styles.thumbnail} style={thumbnailStyle(preset)} aria-hidden="true">
      <div className={styles.thumbnailSheet}>
        {thumbnailBlocks(preset).map((block) => {
          if (block === "logo") return <span key={block} className={styles.thumbLogo} />;
          if (block === "heading") {
            return (
              <span key={block} className={`${styles.thumbHeading} ${isSerif ? styles.thumbSerif : ""}`} />
            );
          }
          if (block === "body") {
            return (
              <span key={block} className={styles.thumbBody}>
                <span />
                <span />
                <span />
              </span>
            );
          }
          if (block === "product") return <span key={block} className={styles.thumbProduct} />;
          return (
            <span key={block} className={styles.thumbButtonRow}>
              <span className={`${styles.thumbButton} ${isOutline ? styles.thumbButtonOutline : ""}`} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function TemplateGallery({
  activePresetId,
  onApply,
  preserveColors,
  onPreserveColorsChange,
  disabled = false,
}: TemplateGalleryProps) {
  return (
    <div className={styles.gallery}>
      <ul className={styles.grid}>
        {EMAIL_TEMPLATE_PRESETS.map((preset) => {
          const isActive = preset.id === activePresetId;

          return (
            <li key={preset.id}>
              <button
                type="button"
                className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
                onClick={() => onApply(preset.id)}
                disabled={disabled}
                // Not aria-pressed: clicking this is an action that rewrites the draft, not a
                // toggle that can be switched back off. "Current" is announced in the label
                // instead, which is also what a sighted merchant reads.
                aria-label={
                  isActive
                    ? `${preset.name} — current style. Reapply to this template.`
                    : `Apply the ${preset.name} style to this template.`
                }
              >
                <Thumbnail preset={preset} />

                <span className={styles.cardBody}>
                  <span className={styles.cardHeader}>
                    <span className={styles.cardName}>{preset.name}</span>
                    {isActive ? <span className={styles.currentTag}>Current</span> : null}
                  </span>
                  <span className={styles.cardDescription}>{preset.description}</span>
                  <span className={styles.traits}>
                    {preset.traits.map((trait) => (
                      <span key={trait} className={styles.trait}>
                        {trait}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The input and both lines of text are direct children of the label, laid out by grid
          rather than nested in a wrapper span — a wrapper puts the accessible text out of
          reach of the label and leaves the control effectively unnamed. */}
      <label className={styles.preserve}>
        <input
          type="checkbox"
          checked={preserveColors}
          onChange={(event) => onPreserveColorsChange(event.target.checked)}
          disabled={disabled}
        />
        <span className={styles.preserveLabel}>Keep my colours when applying a style</span>
        <span className={styles.preserveHint}>
          Your button colour and label colour stay as they are. Type, spacing, width, corners and button style still
          change.
        </span>
      </label>

      <p className={styles.footnote}>
        Applying a style changes how the email looks, never what it says. Your subject, wording, logo, reply-to address
        and any custom HTML are left exactly as they are, and nothing is saved until you choose Save.
      </p>
    </div>
  );
}
