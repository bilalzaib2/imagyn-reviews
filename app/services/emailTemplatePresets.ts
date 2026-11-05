// Imagyn Reviews — Email Studio template library.
//
// The five shipped visual directions a merchant can start from, so the first thing they see
// in Email Studio is a set of finished-looking emails rather than a wall of sliders. Every
// preset is expressed entirely in terms of the EXISTING EmailTemplateContent contract
// (email.shared.ts) — there is no second content model, no parallel renderer, and no new
// database column. A preset is a named bundle of values this app could already store.
//
// WHAT A PRESET MAY AND MAY NOT CHANGE
//
// This is the whole design of the file, and it exists because applying a template must never
// be the moment a merchant loses work. A preset changes PRESENTATION and nothing else:
//
//   CHANGED   accentColor, buttonTextColor, theme, fontFamily, headingSize, bodySize,
//             density, contentWidth, cornerRadius, buttonStyle, buttonAlign
//
//   PRESERVED subject, previewText, heading, bodyText, closingText, buttonText
//               — the merchant's own words, which no style change has any business rewriting.
//             logoUrl, logoDarkUrl, logoSource, logoWidth
//               — a logo's right size depends on the merchant's actual artwork, which a
//                 preset cannot see. A 300x40 wordmark and a square avatar want very
//                 different widths, so guessing here would visibly break one of them.
//             displayName, replyToEmail
//               — identity and routing, not style.
//             showStoreName, showPoweredBy
//               — merchant choices, and showPoweredBy is additionally plan-enforced
//                 (sanitizeEmailTemplateContentForPlan). A preset must never be a way to
//                 flip an entitlement.
//             customHtmlEnabled, customHtml
//               — a merchant who hand-wrote HTML has opted out of the structured editor
//                 entirely. Applying a preset leaves their markup untouched; it restyles the
//                 structured body they would get if they switched back.
//
// Two narrow, deliberate exceptions, both additive and both visible in the live preview
// before anything is saved — see applyEmailTemplatePreset, which enforces them in code
// rather than trusting each preset definition to behave:
//
//   1. A preset may set showProduct to true. It may NEVER set it to false. "Product
//      Showcase" is meaningless without the product block, but a merchant who deliberately
//      turned the product off must not have it reinstated by picking a different typeface.
//   2. A preset may REORDER sections. It may never add, remove, enable or disable one: the
//      merchant's own enabled/disabled flags are carried across the reorder untouched.
//
// Nothing here persists. The route applies a preset to the in-memory draft, the existing
// debounced preview re-renders it, and the merchant saves — or navigates away and keeps what
// they had.

import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_BUTTON_TEXT_COLOR,
  normalizeEmailSections,
  type EmailAlign,
  type EmailButtonStyle,
  type EmailDensity,
  type EmailFontFamily,
  type EmailSectionId,
  type EmailTemplateContent,
  type EmailTextSize,
  type EmailTheme,
} from "./email.shared";

export type EmailTemplatePresetId = "minimal" | "modern" | "editorial" | "classic" | "showcase";

/** Exactly the presentation fields a preset is allowed to set. Typed as a Pick of the real
 *  content contract rather than a hand-written interface, so adding a presentation field to
 *  EmailTemplateContent and forgetting it here is a compile error in every preset below —
 *  not a preset that silently stops styling part of the email. */
export type EmailPresetPresentation = Pick<
  EmailTemplateContent,
  | "accentColor"
  | "buttonTextColor"
  | "theme"
  | "fontFamily"
  | "headingSize"
  | "bodySize"
  | "density"
  | "contentWidth"
  | "cornerRadius"
  | "buttonStyle"
  | "buttonAlign"
>;

export interface EmailTemplatePreset {
  id: EmailTemplatePresetId;
  /** Shown on the gallery card. */
  name: string;
  /** One line describing the direction, in terms of what the merchant will see — never
   *  marketing copy about the template. */
  description: string;
  /** The four or five words a merchant scans instead of reading the description. */
  traits: readonly string[];
  presentation: EmailPresetPresentation;
  /** Additive only — enforced by applyEmailTemplatePreset, which ignores `false`. */
  showProduct?: true;
  /** A reorder of the existing section set. Any id missing from this list keeps its current
   *  relative position after the ones named here; unknown ids are dropped by
   *  normalizeEmailSections. Enabled flags are never read from this list. */
  sectionOrder?: readonly EmailSectionId[];
}

// ---------------------------------------------------------------- The library
//
// Five directions that are genuinely distinguishable in an inbox, not five variations of the
// same email. The knobs that actually carry a visual identity in an email body — which is a
// far more constrained medium than a web page — are typeface class, measure (content width),
// corner radius, button treatment and vertical rhythm. Each preset below moves several of
// those together, so the five are distinct at a glance rather than differing by one slider.

export const EMAIL_TEMPLATE_PRESETS: readonly EmailTemplatePreset[] = [
  {
    id: "minimal",
    name: "Minimal",
    description:
      "A narrow, quiet email that reads like a short note from a person. Charcoal call to action, no decoration, nothing competing with the message.",
    traits: ["Narrow measure", "Sans", "Charcoal CTA", "Left aligned"],
    presentation: {
      // Deliberately identical to BASE_PRESENTATION in email.shared.ts. This preset IS the
      // shipped default, named and shown in the gallery so a merchant who has wandered off
      // into heavy customisation has an obvious, honest way back — and so the gallery does
      // not imply the default is unstyled.
      accentColor: DEFAULT_ACCENT_COLOR,
      buttonTextColor: DEFAULT_BUTTON_TEXT_COLOR,
      theme: "light",
      fontFamily: "sans",
      headingSize: "medium",
      bodySize: "medium",
      density: "normal",
      contentWidth: 480,
      cornerRadius: 8,
      buttonStyle: "filled",
      buttonAlign: "left",
    },
  },
  {
    id: "modern",
    name: "Modern",
    description:
      "Generous spacing, a large heading and a centred button in Imagyn green. The closest thing here to a premium software email.",
    traits: ["Spacious", "Large heading", "Green CTA", "Centred"],
    presentation: {
      // The restrained Imagyn green. Dark label text is not an option here: #5c9754 is dark
      // enough that white type on it measures 3.0:1, which is the right call for a button
      // label at 16px semibold (WCAG's large-text bar) and is what every other filled preset
      // does too.
      accentColor: "#5c9754",
      buttonTextColor: "#ffffff",
      theme: "light",
      fontFamily: "sans",
      headingSize: "large",
      bodySize: "medium",
      density: "relaxed",
      contentWidth: 560,
      cornerRadius: 12,
      buttonStyle: "filled",
      buttonAlign: "center",
    },
  },
  {
    id: "editorial",
    name: "Editorial",
    description:
      "Serif type at a wide measure with hard corners and an outlined button. Confident and magazine-like, for a brand that writes at length.",
    traits: ["Serif", "Wide measure", "Square corners", "Outlined CTA"],
    presentation: {
      // Outline buttons draw their border and label from accentColor, so this value has to
      // clear a text contrast bar rather than a button-background one: near-black on the
      // light body measures 16.9:1.
      accentColor: "#18181b",
      buttonTextColor: "#ffffff",
      theme: "light",
      fontFamily: "serif",
      headingSize: "large",
      bodySize: "large",
      density: "relaxed",
      contentWidth: 640,
      cornerRadius: 0,
      buttonStyle: "outline",
      buttonAlign: "left",
    },
  },
  {
    id: "classic",
    name: "Classic",
    description:
      "Centred serif with a deep green button and tight corners. Traditional and unhurried — suits homeware, stationery and anything handmade.",
    traits: ["Serif", "Centred", "Deep green", "Restrained"],
    presentation: {
      // A deeper, more formal member of the same green family as Modern's, rather than a
      // second unrelated hue. White label on it measures 7.9:1.
      accentColor: "#1f3a34",
      buttonTextColor: "#ffffff",
      theme: "light",
      fontFamily: "serif",
      headingSize: "medium",
      bodySize: "medium",
      density: "normal",
      contentWidth: 520,
      cornerRadius: 4,
      buttonStyle: "filled",
      buttonAlign: "center",
    },
  },
  {
    id: "showcase",
    name: "Product Showcase",
    description:
      "Leads with the product image at full width, with the copy kept short underneath. Built for apparel, furniture and anything bought by eye.",
    traits: ["Image first", "Full width", "Short copy", "Green CTA"],
    presentation: {
      accentColor: "#5c9754",
      buttonTextColor: "#ffffff",
      theme: "light",
      fontFamily: "sans",
      headingSize: "medium",
      // Small body text on purpose: in an image-led email the copy is a caption, and a wide
      // measure at the medium size would pull attention back off the product.
      bodySize: "small",
      density: "compact",
      // The widest measure offered, because this is the only preset whose point is the image,
      // and the product block renders to the content width.
      contentWidth: 640,
      cornerRadius: 12,
      buttonStyle: "filled",
      buttonAlign: "center",
    },
    // The two exceptions documented in this file's header, and the only preset that uses
    // either: an image-led email is defined by the image coming before the words.
    showProduct: true,
    sectionOrder: ["logo", "storeName", "product", "heading", "body", "button", "closing"],
  },
];

const PRESETS_BY_ID = new Map<EmailTemplatePresetId, EmailTemplatePreset>(
  EMAIL_TEMPLATE_PRESETS.map((preset) => [preset.id, preset]),
);

export function isEmailTemplatePresetId(value: unknown): value is EmailTemplatePresetId {
  return typeof value === "string" && PRESETS_BY_ID.has(value as EmailTemplatePresetId);
}

export function getEmailTemplatePreset(id: EmailTemplatePresetId): EmailTemplatePreset {
  const preset = PRESETS_BY_ID.get(id);
  // Unreachable through the type system; present so a future caller that reads an id off a
  // form body gets a real error instead of `undefined.presentation`.
  if (!preset) throw new Error(`Unknown email template preset: ${id}`);
  return preset;
}

export interface ApplyPresetOptions {
  /**
   * Keeps the merchant's existing accentColor and buttonTextColor instead of taking the
   * preset's.
   *
   * Offered because colour is the one part of a preset a merchant is most likely to have
   * already decided deliberately — it is usually their actual brand colour, often copied
   * across from Brand Studio. Everything else a preset changes is a typographic or spatial
   * judgement they are unlikely to have strong feelings about, and all of it is visible in
   * the live preview before anything is saved.
   */
  preserveColors?: boolean;
}

/**
 * Returns a new content object with the preset's presentation applied.
 *
 * Pure: the input is never mutated, nothing is persisted, and the result is an ordinary
 * EmailTemplateContent that still has to go through the route's existing validate → sanitize
 * → save path. Applying a preset is a draft edit, exactly like typing in a field.
 */
export function applyEmailTemplatePreset(
  content: EmailTemplateContent,
  presetId: EmailTemplatePresetId,
  options: ApplyPresetOptions = {},
): EmailTemplateContent {
  const preset = getEmailTemplatePreset(presetId);

  const colors = options.preserveColors
    ? { accentColor: content.accentColor, buttonTextColor: content.buttonTextColor }
    : {
        accentColor: preset.presentation.accentColor,
        buttonTextColor: preset.presentation.buttonTextColor,
      };

  return {
    ...content,
    ...preset.presentation,
    ...colors,

    // Additive only. A preset that tried to set showProduct false would be ignored here
    // rather than trusted — see this file's header.
    showProduct: preset.showProduct === true ? true : content.showProduct,

    sections: preset.sectionOrder
      ? reorderSections(content.sections, preset.sectionOrder)
      : content.sections,
  };
}

/**
 * Reorders the merchant's existing sections to match a preset's running order, carrying every
 * enabled flag across untouched.
 *
 * Sections the preset does not name keep their current relative order and follow the named
 * ones, so a section added to the contract after a preset was written is never silently
 * dropped — normalizeEmailSections would re-append it anyway, but at the end rather than
 * where the merchant had it.
 */
function reorderSections(
  current: EmailTemplateContent["sections"],
  order: readonly EmailSectionId[],
): EmailTemplateContent["sections"] {
  const byId = new Map(current.map((section) => [section.id, section]));
  const placed = new Set<EmailSectionId>();
  const result: EmailTemplateContent["sections"] = [];

  for (const id of order) {
    const section = byId.get(id);
    if (!section || placed.has(id)) continue;
    placed.add(id);
    result.push({ ...section });
  }

  for (const section of current) {
    if (placed.has(section.id)) continue;
    placed.add(section.id);
    result.push({ ...section });
  }

  // Runs the result back through the contract's own repair function rather than trusting this
  // one: it is what guarantees the required sections stay enabled and that nothing unknown
  // or duplicated can reach a send.
  return normalizeEmailSections(result);
}

/**
 * Identifies which preset, if any, the given content currently matches.
 *
 * Used by the gallery to show a "Current" marker, so a merchant can tell at a glance whether
 * they are on a shipped style or have edited away from one. Compares only the fields a preset
 * actually sets — a merchant who rewrote all the copy is still on the Minimal style.
 *
 * Colour is compared too, which means a merchant who applied Modern and then changed the
 * accent to their own brand colour shows as matching nothing. That is the honest answer: the
 * gallery would otherwise claim they are on a style their email no longer looks like.
 */
export function matchEmailTemplatePreset(content: EmailTemplateContent): EmailTemplatePresetId | null {
  for (const preset of EMAIL_TEMPLATE_PRESETS) {
    const p = preset.presentation;
    const matches =
      content.accentColor === p.accentColor &&
      content.buttonTextColor === p.buttonTextColor &&
      content.theme === (p.theme satisfies EmailTheme) &&
      content.fontFamily === (p.fontFamily satisfies EmailFontFamily) &&
      content.headingSize === (p.headingSize satisfies EmailTextSize) &&
      content.bodySize === (p.bodySize satisfies EmailTextSize) &&
      content.density === (p.density satisfies EmailDensity) &&
      content.contentWidth === p.contentWidth &&
      content.cornerRadius === p.cornerRadius &&
      content.buttonStyle === (p.buttonStyle satisfies EmailButtonStyle) &&
      content.buttonAlign === (p.buttonAlign satisfies EmailAlign);

    if (matches) return preset.id;
  }

  return null;
}
