// Imagyn Reviews — Email Studio content contract.
//
// The merchant-editable content for every Email Studio template (rendered by
// emails/ReviewRequestEmail.tsx). Same JSON-as-String-column precedent as
// appearance.shared.ts's AppearanceTokens: the whole object is persisted as one JSON string
// in EmailTemplate.content, so growing this contract never needs a database migration —
// mergeEmailTemplateContent back-fills any field a previously-saved row predates.
//
// PLAN POLICY (the important part — read before adding a gate here):
// Every field in this file is available on EVERY plan, including Free, with exactly one
// exception: showPoweredBy. A merchant can install Imagyn Reviews, send the ready-made
// emails immediately, and then customize copy, colour, typography, spacing, layout, logos,
// sections and even raw HTML without upgrading. That is deliberate product policy, not an
// oversight — see sanitizeEmailTemplateContentForPlan, which is the single server-side
// enforcement point.
//
// showPoweredBy stays Pro because removing Imagyn's own attribution is white-labelling
// (canUseCustomBranding / canUseWhiteLabel), not email customization.
//
// Separately, and unchanged by this contract: whether the two reminder templates are
// automatically SENT remains Pro (canUseEmailReminders, enforced in
// reviewRequestScheduler.server.ts). Free merchants may freely EDIT reminder templates —
// they just do not get the automatic 3-day/7-day sweep until they upgrade. Editing is
// customization; sending on a schedule is the paid capability.

// ---------------------------------------------------------------- Presentation enums
//
// Every enum below is a closed set rendered into inline styles by ReviewRequestEmail.tsx.
// They are enums rather than free strings on purpose: the values reach an email's style
// attributes, so a free-form string here would be an injection surface and would also let a
// merchant produce an email that no client can render.

/** Explicit palette choice. NOT `prefers-color-scheme` — email clients handle that wildly
 *  inconsistently (Gmail and Outlook both auto-invert in ways a sender cannot predict), so
 *  this picks a real, fixed palette that renders identically everywhere instead of pretending
 *  to follow the reader's OS setting. */
export type EmailLogoSource = "shared" | "custom";

export type EmailTheme = "light" | "dark";

/** Email-safe stacks only — no webfonts. Email clients do not reliably load @font-face, so
 *  offering "Inter" or similar would silently fall back to a different face in most inboxes. */
export type EmailFontFamily = "sans" | "serif" | "mono";

export type EmailTextSize = "small" | "medium" | "large";

/** Vertical rhythm multiplier for the whole email. */
export type EmailDensity = "compact" | "normal" | "relaxed";

export type EmailButtonStyle = "filled" | "outline";

export type EmailAlign = "left" | "center";

// ---------------------------------------------------------------- Sections

/** The reorderable, individually toggleable blocks of the email body.
 *
 *  Deliberately NOT included here: the link fallback, the unsubscribe line and the
 *  "Powered by" line. Those are compliance/deliverability furniture, always rendered last in
 *  a fixed order, and are not the merchant's to reorder — see ReviewRequestEmail.tsx. */
export type EmailSectionId =
  | "logo"
  | "storeName"
  | "heading"
  | "body"
  | "product"
  | "stars"
  | "button"
  | "closing";

export interface EmailSection {
  id: EmailSectionId;
  enabled: boolean;
}

/** Canonical order and default on/off state. A template saved before a new section existed
 *  gets it appended here, in this position, with this default — see normalizeEmailSections. */
export const DEFAULT_EMAIL_SECTIONS: readonly EmailSection[] = [
  { id: "logo", enabled: true },
  { id: "storeName", enabled: true },
  { id: "heading", enabled: true },
  { id: "body", enabled: true },
  { id: "product", enabled: true },
  // One-tap star rating, directly above the CTA.
  //
  // On by default — but "default" here means a store with NO saved template, which is every
  // new install. A store that has already saved a template keeps the email it had: see
  // SECTIONS_ADDED_AFTER_LAUNCH below, which is what stops this list from silently changing
  // the shape of a live email. Reversible either way in Email Studio.
  { id: "stars", enabled: true },
  { id: "button", enabled: true },
  { id: "closing", enabled: true },
];

const KNOWN_SECTION_IDS: readonly EmailSectionId[] = DEFAULT_EMAIL_SECTIONS.map((section) => section.id);

/** The CTA is the entire point of a review-request email, so it cannot be switched off. It
 *  can still be reordered and restyled. Enforced in normalizeEmailSections, not just hidden
 *  in the editor, so a direct POST cannot produce an email with no way to leave a review. */
export const REQUIRED_SECTION_IDS: readonly EmailSectionId[] = ["button"];

export const EMAIL_SECTION_LABELS: Record<EmailSectionId, string> = {
  logo: "Logo",
  storeName: "Store name",
  heading: "Heading",
  body: "Message",
  product: "Product",
  stars: "Star rating row",
  button: "Review button",
  closing: "Closing",
};

/**
 * Sections added to this contract after merchants were already saving templates.
 *
 * THE RULE, and the reason this set exists at all:
 *
 *   A section in here is back-filled **disabled** when it is absent from an explicitly saved
 *   section list, even though DEFAULT_EMAIL_SECTIONS has it on.
 *
 * Those two facts are not in conflict — they are the whole design:
 *
 *   - A store with **no saved template** renders DEFAULT_EMAIL_SECTIONS directly (see
 *     getDefaultEmailTemplateContent, which does not route through normalizeEmailSections).
 *     That is every new install, and it gets the new block switched on.
 *   - A store **with a saved template** from before the section existed has an explicit list
 *     that lacks it. Back-filling that list as *enabled* would change the shape of an email
 *     the merchant has already reviewed, approved and watched go out — without them touching
 *     anything. A new block appearing in a live customer email is not an upgrade a merchant
 *     asked for, so the answer is off, visible in Email Studio, and theirs to turn on.
 *
 * A section only ever belongs in here once; it is a migration record, not a feature flag.
 * Nothing reads it at send time.
 */
export const SECTIONS_ADDED_AFTER_LAUNCH: readonly EmailSectionId[] = ["stars"];

/** Repairs any section list into a valid one: drops unknown ids, de-duplicates, appends
 *  sections the saved row predates (in canonical position), and force-enables the required
 *  ones. Tolerant rather than throwing — a malformed list should never break a live send. */
export function normalizeEmailSections(input: unknown): EmailSection[] {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set<EmailSectionId>();
  const result: EmailSection[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    if (!(KNOWN_SECTION_IDS as string[]).includes(id)) continue;
    const sectionId = id as EmailSectionId;
    if (seen.has(sectionId)) continue;
    seen.add(sectionId);
    result.push({
      id: sectionId,
      enabled: REQUIRED_SECTION_IDS.includes(sectionId) ? true : (entry as { enabled?: unknown }).enabled !== false,
    });
  }

  // A section listed in SECTIONS_ADDED_AFTER_LAUNCH is back-filled OFF rather than at its
  // canonical default, because an input that names other sections but not this one is a
  // template saved before the section existed — and that merchant's live email must not change
  // shape on its own.
  //
  // `hadExplicitList` is the distinction that makes this safe: an empty or malformed input is
  // not "a saved row predating the section", it is no row at all, so it gets the full shipped
  // defaults exactly as a new install does.
  const hadExplicitList = result.length > 0;

  for (const fallback of DEFAULT_EMAIL_SECTIONS) {
    if (seen.has(fallback.id)) continue;

    const isLateAddition = SECTIONS_ADDED_AFTER_LAUNCH.includes(fallback.id);
    const section: EmailSection = {
      ...fallback,
      enabled: hadExplicitList && isLateAddition ? false : fallback.enabled,
    };

    if (isLateAddition) {
      // Placed where it belongs rather than appended. Appending put the star row after the
      // closing sign-off for every existing merchant — harmless while it is off, and visibly
      // wrong the moment one of them switches it on, which is precisely the case this whole
      // back-fill exists to serve. Inserting it before its canonical neighbour (the review
      // button) is what makes "turn it on" produce the composition the preview and the
      // template gallery both show.
      //
      // Scoped to late additions on purpose: for every other section, "append what the input
      // did not mention" is long-standing behaviour on malformed input, and changing where
      // those land would reorder a merchant's email to fix nothing.
      insertBeforeCanonicalNeighbour(result, section);
    } else {
      result.push(section);
    }
  }

  return result;
}

/**
 * Inserts a back-filled section immediately before whichever section follows it in
 * DEFAULT_EMAIL_SECTIONS, falling back to the end of the list when none of them is present.
 *
 * Mutates `result` in place — it is a local array inside normalizeEmailSections and never
 * escapes before this runs.
 */
function insertBeforeCanonicalNeighbour(result: EmailSection[], section: EmailSection): void {
  const canonicalIndex = DEFAULT_EMAIL_SECTIONS.findIndex((entry) => entry.id === section.id);
  const successors = DEFAULT_EMAIL_SECTIONS.slice(canonicalIndex + 1).map((entry) => entry.id);

  for (const successorId of successors) {
    const at = result.findIndex((entry) => entry.id === successorId);
    if (at !== -1) {
      result.splice(at, 0, section);
      return;
    }
  }

  result.push(section);
}

// ---------------------------------------------------------------- Content

export interface EmailTemplateContent {
  /** Supports {{variables}} — see EMAIL_TEMPLATE_VARIABLES below. */
  subject: string;
  /** The snippet most inbox clients show next to the subject. Supports {{variables}}. Empty
   *  falls back to the rendered subject, which is what this app did before the field existed. */
  previewText: string;
  /** The large heading line at the top of the email body. Supports {{variables}}. */
  heading: string;
  /** The paragraph beneath the heading. Supports {{variables}}. */
  bodyText: string;
  /** Sign-off beneath the CTA. Supports {{variables}}. */
  closingText: string;
  /** Text on the review CTA button. Does not support variables — kept short and literal. */
  buttonText: string;
  /** The line above the one-tap star row ("stars" section). Supports {{variables}}.
   *
   *  Must stay neutral about what rating to give. The star row links all five ratings to the
   *  same form with nothing conditional on the choice — see ReviewRequestEmail.tsx — and copy
   *  that nudged toward five stars would turn an honest shortcut into review gating, which is
   *  both a Shopify App Store violation and an FTC problem. validateEmailStarsPrompt below is
   *  what stops a merchant writing that copy. */
  starsPrompt: string;

  /** Hex colour for the CTA button (its background when filled, its border/label when
   *  outline). */
  accentColor: string;
  /** Hex colour for the CTA label when the button is filled. Exposed because a light accent
   *  (a pastel or a yellow) needs dark label text to stay legible, and guessing that from
   *  luminance would silently override a deliberate choice. */
  buttonTextColor: string;
  theme: EmailTheme;
  fontFamily: EmailFontFamily;
  headingSize: EmailTextSize;
  bodySize: EmailTextSize;
  density: EmailDensity;
  /** Body width in px, clamped by normalizeEmailTemplateContent. */
  contentWidth: number;
  /** Button/card corner radius in px, clamped by normalizeEmailTemplateContent. */
  cornerRadius: number;
  buttonStyle: EmailButtonStyle;
  buttonAlign: EmailAlign;

  /** null = no logo. The light-theme logo, and the one used whenever a dark variant is not
   *  supplied. Always a raster URL (PNG/JPEG/WebP) — an uploaded SVG is sanitized and
   *  rasterized to PNG before it lands here, because email clients do not render SVG. See
   *  emailSanitize.server.ts and the route's upload-logo intent. */
  logoUrl: string | null;
  /** null = reuse logoUrl. A separate asset for the dark palette, since a dark-ink wordmark
   *  disappears on a dark background. */
  logoDarkUrl: string | null;
  /** Where this template's logo comes from.
   *
   *  "shared"  — the store's Email Branding logo (Store.emailLogoUrl/emailLogoDarkUrl).
   *              This is the default, and it is the whole point of the shared system: a
   *              merchant uploads once and every template follows, with no stale copy
   *              cached per template.
   *  "custom"  — this template deliberately overrides the shared logo with logoUrl /
   *              logoDarkUrl above.
   *
   *  MIGRATION: absent on every template saved before this field existed. normalize infers
   *  "custom" when such a template already has a logoUrl, so an existing merchant keeps the
   *  exact asset they uploaded instead of silently switching to a shared logo that is not
   *  set yet. Templates with no logo default to "shared" and start inheriting immediately. */
  logoSource: EmailLogoSource;
  /** Rendered logo width in px, clamped by normalizeEmailTemplateContent. Height is always
   *  auto so a wordmark is never squashed. */
  logoWidth: number;

  /** null/empty = show the real Shopify store name. Lets a merchant show a friendlier or
   *  shorter name inside the email body (the eyebrow line and the {{store_name}} variable)
   *  without changing the actual sender identity — the From header always uses the real
   *  store name regardless (see resend.server.ts's fromName). */
  displayName: string | null;
  showStoreName: boolean;
  /** Renders the purchased product (image + name) when the send actually has that data.
   *  Never invents a product — see ReviewRequestEmail.tsx, which skips the block entirely
   *  when productName is absent, and templates.server.tsx, which only passes a real image. */
  showProduct: boolean;
  /** The small "Powered by Imagyn Reviews" footer line. THE ONE PRO-GATED FIELD in this
   *  contract — force-overwritten to true for any store without canUseCustomBranding by
   *  sanitizeEmailTemplateContentForPlan, regardless of what is persisted or what a direct
   *  POST claims. Removing it is white-labelling, not email customization. */
  showPoweredBy: boolean;
  /** null = replies go to Resend's shared From address. When set, a real customer reply
   *  lands in an inbox the merchant reads. Never changes the sender avatar/identity shown by
   *  inbox clients — that genuinely needs a verified sending domain, which this app does not
   *  yet support, and Email Studio's copy must keep saying so rather than implying a logo
   *  upload changes it. */
  replyToEmail: string | null;

  /** Order and on/off state of the body blocks. */
  sections: EmailSection[];

  /** When true the structured fields above stop driving the body and customHtml is rendered
   *  instead. Subject, preview text and the compliance footer still come from this contract —
   *  a merchant cannot opt out of the unsubscribe line by switching to HTML. */
  customHtmlEnabled: boolean;
  /** Merchant-authored HTML. NEVER rendered or persisted raw: sanitizeEmailHtml
   *  (emailSanitize.server.ts) strips scripts, event handlers and unsafe URLs on save and
   *  again on every send. Supports {{variables}}. */
  customHtml: string;
}

export const DEFAULT_ACCENT_COLOR = "#111111";
export const DEFAULT_BUTTON_TEXT_COLOR = "#ffffff";
export const DEFAULT_CONTENT_WIDTH = 480;
export const DEFAULT_CORNER_RADIUS = 8;
export const DEFAULT_LOGO_WIDTH = 40;

export const CONTENT_WIDTH_RANGE = { min: 320, max: 720 } as const;
export const CORNER_RADIUS_RANGE = { min: 0, max: 24 } as const;
export const LOGO_WIDTH_RANGE = { min: 24, max: 240 } as const;

// One row per (store, type) in EmailTemplate — "review_request" is the Day-0 send every store
// gets; "reminder_1"/"reminder_final" back the Automatic Reminder Emails (see
// reviewRequestScheduler.server.ts's runDueReminderSweep, whose Pro gate is unchanged);
// "reward" backs Review Rewards' customer-communication step (see rewards.server.ts's
// evaluateAndIssueReward) — sent only after a real Shopify discount code has actually been
// created, never before.
export type EmailTemplateType = "review_request" | "reminder_1" | "reminder_final" | "reward";

export const EMAIL_TEMPLATE_TYPES: readonly EmailTemplateType[] = [
  "review_request",
  "reminder_1",
  "reminder_final",
  "reward",
];

export function isEmailTemplateType(value: unknown): value is EmailTemplateType {
  return typeof value === "string" && (EMAIL_TEMPLATE_TYPES as readonly string[]).includes(value);
}

/** Presentation defaults shared by every template type — only the copy differs per type. */
const BASE_PRESENTATION = {
  accentColor: DEFAULT_ACCENT_COLOR,
  buttonTextColor: DEFAULT_BUTTON_TEXT_COLOR,
  theme: "light" as EmailTheme,
  fontFamily: "sans" as EmailFontFamily,
  headingSize: "medium" as EmailTextSize,
  bodySize: "medium" as EmailTextSize,
  density: "normal" as EmailDensity,
  contentWidth: DEFAULT_CONTENT_WIDTH,
  cornerRadius: DEFAULT_CORNER_RADIUS,
  buttonStyle: "filled" as EmailButtonStyle,
  buttonAlign: "left" as EmailAlign,
  logoUrl: null,
  logoDarkUrl: null,
  logoSource: "shared" as EmailLogoSource,
  logoWidth: DEFAULT_LOGO_WIDTH,
  displayName: null,
  showStoreName: true,
  showProduct: true,
  showPoweredBy: true,
  replyToEmail: null,
  customHtmlEnabled: false,
  customHtml: "",
};

// The shipped copy. These are real, finished emails — a merchant who never opens Email Studio
// still sends something polished and on-brand, which is the whole point of the defaults being
// part of the product rather than placeholder text.
//
// Copy rules encoded here deliberately:
//  - Asks for an HONEST review, never a positive one, and never conditions anything on the
//    rating. Review-gating is both a Shopify App Store violation and an FTC problem.
//  - No invented urgency, scarcity, social proof or product claims.
//  - Reads like the merchant wrote it, not like a software notification.
//  - Every {{token}} below is one the sender genuinely has data for — see
//    EMAIL_TEMPLATE_VARIABLES and templates.server.tsx.
export function getDefaultEmailTemplateContent(type: EmailTemplateType = "review_request"): EmailTemplateContent {
  const sections = DEFAULT_EMAIL_SECTIONS.map((section) => ({ ...section }));

  if (type === "reward") {
    return {
      ...BASE_PRESENTATION,
      // The one template whose section list differs from the canonical default: its CTA points
      // at the storefront, not a review form, so a star row here would have no rating to carry.
      // Disabled rather than left on as a toggle that does nothing.
      sections: sections.map((section) => (section.id === "stars" ? { ...section, enabled: false } : section)),
      subject: "A thank-you from {{store_name}}",
      previewText: "Your discount code is inside.",
      heading: "Thank you for your review",
      bodyText:
        "Hi {{customer_name}},\n\nThanks for taking the time to share your thoughts on {{product_name}} — it genuinely helps other shoppers decide, and it helps us get better.\n\nHere's a discount code for your next order, with our thanks: {{discount_code}}",
      closingText: "Thanks again,\n{{store_name}}",
      buttonText: "Shop now",
      starsPrompt: "",
    };
  }

  if (type === "reminder_1") {
    return {
      ...BASE_PRESENTATION,
      sections,
      subject: "Any thoughts on your {{product_name}}?",
      previewText: "It only takes a minute, and it really helps.",
      heading: "How's it going so far?",
      bodyText:
        "Hi {{customer_name}},\n\nWe reached out recently about your {{product_name}}, and we know inboxes get busy.\n\nIf you've had a chance to try it, we'd still love to hear how you're finding it. Honest feedback is the most useful kind — whatever your experience has been.",
      closingText: "Thanks for being our customer,\n{{store_name}}",
      buttonText: "Write a review",
      starsPrompt: "How many stars would you give it?",
    };
  }

  if (type === "reminder_final") {
    return {
      ...BASE_PRESENTATION,
      sections,
      subject: "One last note about your {{product_name}}",
      previewText: "No pressure either way.",
      heading: "We'll leave it here",
      bodyText:
        "Hi {{customer_name}},\n\nThis is the last time we'll ask about your {{product_name}} — we don't want to clutter your inbox.\n\nIf you'd like to share how it went, the link below is always open. If not, that's completely fine, and we appreciate your order either way.",
      closingText: "All the best,\n{{store_name}}",
      buttonText: "Share your experience",
      starsPrompt: "How many stars would you give it?",
    };
  }

  return {
    ...BASE_PRESENTATION,
    sections,
    subject: "How are you liking your recent purchase?",
    previewText: "We'd love to hear what you think.",
    heading: "How did we do?",
    bodyText:
      "Hi {{customer_name}},\n\nThank you for shopping with {{store_name}}. We hope you're enjoying your {{product_name}}.\n\nWhen you have a moment, we'd love to hear about your experience. Your honest feedback helps us improve, and it helps other shoppers decide with confidence.",
    closingText: "Thanks for being our customer,\n{{store_name}}",
    buttonText: "Write a review",
    starsPrompt: "How many stars would you give it?",
  };
}

// Merges a partial/legacy-shaped record over the current defaults — the same tolerant-upgrade
// pattern mergeAppearanceTokens established. A row saved before a field existed must never
// crash the reader; it falls back per field. `type` picks which template's defaults back-fill,
// so a partially-saved reminder never silently reverts to review-request copy.
export function mergeEmailTemplateContent(
  partial: Partial<EmailTemplateContent>,
  type: EmailTemplateType = "review_request",
): EmailTemplateContent {
  const defaults = getDefaultEmailTemplateContent(type);

  // The one place that knows it is reading a SAVED row rather than building a fresh default —
  // emailTemplate.server.ts's parseContent is its only production caller. That distinction is
  // what protects an existing merchant's live email from gaining a new block on its own.
  //
  // normalizeEmailSections already handles the common case (a saved list that names other
  // sections but not a late addition). This handles the older one: a row saved before the
  // `sections` field existed at all has no list to inspect, and merging the defaults in would
  // hand normalize a list that already contains the late addition, enabled. Substituting the
  // pre-late-addition list makes such a row look like exactly what it is — a template saved
  // before `stars` existed — so it is back-filled off like every other saved row.
  //
  // An empty partial is not a saved row. It is no row at all, and gets the full shipped
  // defaults, which is what a new install renders.
  const isSavedRow = Object.keys(partial).length > 0;
  const sections =
    Array.isArray(partial.sections) || !isSavedRow
      ? (partial.sections ?? defaults.sections)
      : defaults.sections.filter((section) => !SECTIONS_ADDED_AFTER_LAUNCH.includes(section.id));

  const merged = { ...defaults, ...partial, sections };
  return normalizeEmailTemplateContent(merged, type);
}

function clampInt(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(parsed)));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function pickColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/** Clamps every bounded value to something an email can actually render.
 *
 *  Plan-independent on purpose, and separate from sanitizeEmailTemplateContentForPlan: this
 *  is about producing a *valid* email (a 9000px body or a `contentWidth: "red"` from a direct
 *  POST is not), whereas that one is about *entitlement*. Both run on save; only this one runs
 *  on read, because a row persisted before a field was clamped still has to render. */
export function normalizeEmailTemplateContent(
  content: EmailTemplateContent,
  type: EmailTemplateType = "review_request",
): EmailTemplateContent {
  const defaults = getDefaultEmailTemplateContent(type);

  return {
    ...content,
    subject: typeof content.subject === "string" ? content.subject : defaults.subject,
    previewText: typeof content.previewText === "string" ? content.previewText : defaults.previewText,
    heading: typeof content.heading === "string" ? content.heading : defaults.heading,
    bodyText: typeof content.bodyText === "string" ? content.bodyText : defaults.bodyText,
    closingText: typeof content.closingText === "string" ? content.closingText : defaults.closingText,
    buttonText: typeof content.buttonText === "string" ? content.buttonText : defaults.buttonText,
    starsPrompt: typeof content.starsPrompt === "string" ? content.starsPrompt : defaults.starsPrompt,

    accentColor: pickColor(content.accentColor, defaults.accentColor),
    buttonTextColor: pickColor(content.buttonTextColor, defaults.buttonTextColor),
    theme: pickEnum<EmailTheme>(content.theme, ["light", "dark"], defaults.theme),
    fontFamily: pickEnum<EmailFontFamily>(content.fontFamily, ["sans", "serif", "mono"], defaults.fontFamily),
    headingSize: pickEnum<EmailTextSize>(content.headingSize, ["small", "medium", "large"], defaults.headingSize),
    bodySize: pickEnum<EmailTextSize>(content.bodySize, ["small", "medium", "large"], defaults.bodySize),
    density: pickEnum<EmailDensity>(content.density, ["compact", "normal", "relaxed"], defaults.density),
    contentWidth: clampInt(content.contentWidth, CONTENT_WIDTH_RANGE, defaults.contentWidth),
    cornerRadius: clampInt(content.cornerRadius, CORNER_RADIUS_RANGE, defaults.cornerRadius),
    buttonStyle: pickEnum<EmailButtonStyle>(content.buttonStyle, ["filled", "outline"], defaults.buttonStyle),
    buttonAlign: pickEnum<EmailAlign>(content.buttonAlign, ["left", "center"], defaults.buttonAlign),

    logoUrl: content.logoUrl?.trim() || null,
    logoDarkUrl: content.logoDarkUrl?.trim() || null,
    // The one piece of real migration logic in this contract. A template saved before
    // logoSource existed carries no value for it; inferring "custom" whenever it already
    // has a logo is what stops the shared-branding rollout from blanking a logo a merchant
    // uploaded months ago. Anything else — including an explicitly stored value — is taken
    // at face value, so a merchant who switches a template back to "shared" stays shared.
    logoSource: pickEnum<EmailLogoSource>(
      content.logoSource,
      ["shared", "custom"],
      content.logoUrl?.trim() ? "custom" : defaults.logoSource,
    ),
    logoWidth: clampInt(content.logoWidth, LOGO_WIDTH_RANGE, defaults.logoWidth),

    displayName: content.displayName?.trim() || null,
    showStoreName: content.showStoreName !== false,
    showProduct: content.showProduct !== false,
    showPoweredBy: content.showPoweredBy !== false,
    replyToEmail: content.replyToEmail?.trim() || null,

    sections: normalizeEmailSections(content.sections),

    customHtmlEnabled: content.customHtmlEnabled === true,
    customHtml: typeof content.customHtml === "string" ? content.customHtml : "",
  };
}

// The server-side enforcement point for plan entitlement, called by app.email-studio.tsx's
// save action before persisting — exactly like app.appearance.tsx strips Pro-only Brand Studio
// fields rather than trusting the UI never sent them.
//
// Every email-customization field is intentionally plan-independent (see this file's header).
// showPoweredBy is the only entitlement left here: force-overwritten to true for any store
// without canUseCustomBranding, so a Free store can never make the "Powered by Imagyn" footer
// disappear by any path, including a hand-crafted POST or a custom HTML template (the footer
// is appended by the renderer, not by merchant markup).
// Every field is listed explicitly rather than spread, so that an unrecognized key smuggled
// into a direct POST cannot ride along into the persisted JSON. That property is load-bearing
// for a JSON-column contract like this one: there is no database schema to reject an unknown
// column, so this function IS the schema.
export function sanitizeEmailTemplateContentForPlan(
  content: EmailTemplateContent,
  permissions: { canUseCustomBranding: boolean },
): EmailTemplateContent {
  return {
    subject: content.subject,
    previewText: content.previewText,
    heading: content.heading,
    bodyText: content.bodyText,
    closingText: content.closingText,
    buttonText: content.buttonText,
    starsPrompt: content.starsPrompt,

    accentColor: content.accentColor,
    buttonTextColor: content.buttonTextColor,
    theme: content.theme,
    fontFamily: content.fontFamily,
    headingSize: content.headingSize,
    bodySize: content.bodySize,
    density: content.density,
    contentWidth: content.contentWidth,
    cornerRadius: content.cornerRadius,
    buttonStyle: content.buttonStyle,
    buttonAlign: content.buttonAlign,

    logoUrl: content.logoUrl,
    logoDarkUrl: content.logoDarkUrl,
    logoSource: content.logoSource,
    logoWidth: content.logoWidth,

    displayName: content.displayName,
    showStoreName: content.showStoreName,
    showProduct: content.showProduct,
    showPoweredBy: permissions.canUseCustomBranding ? content.showPoweredBy : true,
    replyToEmail: content.replyToEmail,

    sections: content.sections.map((section) => ({ id: section.id, enabled: section.enabled })),

    customHtmlEnabled: content.customHtmlEnabled,
    customHtml: content.customHtml,
  };
}

// ---------------------------------------------------------------- Variables

export interface EmailTemplateVariableValues {
  customerName: string;
  storeName: string;
  productName: string;
  /** Reward emails only — the real, already-issued Shopify discount code. Absent (never
   *  substituted) for every other template type, since no other send has one. */
  discountCode?: string;
}

// The variables Email Studio exposes — each maps 1:1 onto data the sender already has on hand
// (ReviewRequestRecord.name/store.name/product.name, or the just-issued Reward's discountCode),
// so no new data flow is needed to support them. `token` is what the merchant inserts;
// `describe` is the label shown in the editor's "Insert variable" control.
export const EMAIL_TEMPLATE_VARIABLES: Array<{ token: string; describe: string }> = [
  { token: "{{customer_name}}", describe: "Customer's first name" },
  { token: "{{store_name}}", describe: "Store name" },
  { token: "{{product_name}}", describe: "Product name" },
];

export const REWARD_EMAIL_TEMPLATE_VARIABLES: Array<{ token: string; describe: string }> = [
  ...EMAIL_TEMPLATE_VARIABLES,
  { token: "{{discount_code}}", describe: "The issued discount code" },
];

export function variablesForType(type: EmailTemplateType) {
  return type === "reward" ? REWARD_EMAIL_TEMPLATE_VARIABLES : EMAIL_TEMPLATE_VARIABLES;
}

/** Any {{token}} at all, used to find ones this app cannot resolve. */
const ANY_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Returns the unknown {{tokens}} in a merchant's text.
 *
 *  Exists so the editor can REJECT a typo on save rather than letting it reach a customer:
 *  renderTemplateVariables deliberately leaves unrecognized tokens as literal text (safer
 *  than deleting copy mid-send), which means "{{frist_name}}" would otherwise ship verbatim
 *  to a real inbox. Validation at the save boundary is what keeps that from happening. */
export function findUnknownVariables(text: string, type: EmailTemplateType = "review_request"): string[] {
  const known = new Set(variablesForType(type).map((variable) => variable.token.replace(/[{}\s]/g, "")));
  const unknown = new Set<string>();

  for (const match of text.matchAll(ANY_TOKEN)) {
    if (!known.has(match[1])) unknown.add(`{{${match[1]}}}`);
  }

  return [...unknown];
}

// Plain {{token}} replacement, not a templating engine — deliberately so: the input is
// merchant-authored free text, never executed, and the only tokens that can ever appear are
// the ones declared above. Unknown/malformed tokens are left as literal text rather than
// throwing, so a merchant's typo never breaks a live send (findUnknownVariables above is what
// stops one being saved in the first place).
export function renderTemplateVariables(text: string, values: EmailTemplateVariableValues): string {
  let result = text
    .replaceAll("{{customer_name}}", values.customerName)
    .replaceAll("{{store_name}}", values.storeName)
    .replaceAll("{{product_name}}", values.productName);

  if (values.discountCode) {
    result = result.replaceAll("{{discount_code}}", values.discountCode);
  }

  return result;
}

/**
 * Last-resort removal of any {{token}} still present after substitution.
 *
 * renderTemplateVariables leaves an unrecognized token as literal text, which is the right
 * behaviour mid-pipeline (deleting a merchant's copy on a typo would be worse). But nothing
 * with a raw token in it may ever reach a real inbox, so the final render step strips what
 * is left.
 *
 * In practice this should never fire: findUnknownVariables rejects typos at the save
 * boundary, and every caller supplies the values its template type declares. It exists for
 * the gap between those two guarantees — most concretely a reward send that somehow has no
 * discount code, where the alternative is a customer receiving the characters
 * "{{discount_code}}". Callers log when it fires so the underlying omission is visible.
 */
export function stripUnresolvedVariables(text: string): string {
  // Also collapses a space or a dangling ": " left in front of the removed token, so the
  // degraded sentence reads as a clean truncation rather than obviously broken punctuation.
  return text.replace(/\s*:?\s*\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, "").trimEnd();
}

// ---------------------------------------------------------------- One-tap star rating

/** The ratings the email's star row offers, lowest first — the order they are rendered in. */
export const EMAIL_STAR_RATINGS: readonly number[] = [1, 2, 3, 4, 5];

/** The query parameter the star links carry, read by the review landing page (r.$token.tsx)
 *  to pre-select the rating the customer already chose in their inbox. */
export const RATING_QUERY_PARAM = "r";

/**
 * Builds the destination for one star in the email's rating row.
 *
 * Every rating goes to the SAME form — the only difference is which star arrives
 * pre-selected. Nothing is recorded by following one of these links, nothing is conditional
 * on the number, and a one-star tap lands on exactly the page a five-star tap does.
 *
 * That is not an implementation detail, it is the whole legal shape of the feature: routing
 * low ratings somewhere else (a "tell us privately" form, a support inbox) is review gating,
 * which violates the Shopify App Store requirements and the FTC's rules on review
 * suppression. Keeping URL construction in one shared function is what makes that property
 * checkable in one place instead of trusted across a renderer and three callers.
 */
export function buildRatingUrl(reviewUrl: string, rating: number): string {
  const rounded = Math.round(rating);
  if (!EMAIL_STAR_RATINGS.includes(rounded)) {
    throw new Error(`Rating must be one of ${EMAIL_STAR_RATINGS.join(", ")} — received ${rating}`);
  }

  // Appended textually rather than via `new URL`, because this runs on a URL built from
  // SHOPIFY_APP_URL and a token and must not throw on a trailing-slash or relative-looking
  // value in a misconfigured environment. The parameter name and value are both fixed
  // constants here, so there is nothing to encode.
  const separator = reviewUrl.includes("?") ? "&" : "?";
  return `${reviewUrl}${separator}${RATING_QUERY_PARAM}=${rounded}`;
}

/** Builds all five star destinations for one send, lowest rating first. */
export function buildRatingUrls(reviewUrl: string): string[] {
  return EMAIL_STAR_RATINGS.map((rating) => buildRatingUrl(reviewUrl, rating));
}

/**
 * Parses the rating a star link carried, returning null for anything that is not one of the
 * five offered values.
 *
 * Deliberately strict and deliberately silent: this reaches a public, unauthenticated page
 * from a link anyone can edit, so "?r=0", "?r=11", "?r=<script>" and "?r=5;DROP" must all
 * degrade to "no pre-selection" rather than to an error page a customer cannot get past.
 */
export function parseRatingParam(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  // Trimmed first: whitespace around an otherwise valid rating is a copy-paste artefact, not
  // an attack, and refusing it would discard a choice the customer really made.
  const trimmed = value.trim();
  // Digits only — Number() would happily accept "5e0", "0x5" and "+5".
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return EMAIL_STAR_RATINGS.includes(parsed) ? parsed : null;
}

/** Phrases that turn the honest star row into review gating. */
const GATING_PHRASES: readonly RegExp[] = [
  /\bfive[\s-]?stars?\b/i,
  /\b5[\s-]?stars?\b/i,
  /\bpositive review\b/i,
  /\bgood review\b/i,
  /\bgreat review\b/i,
  /\bonly if you\b/i,
];

/**
 * Rejects star-row copy that steers the customer toward a particular rating.
 *
 * Called at the save boundary (app.email-studio.tsx) alongside findUnknownVariables. The
 * star row is the one place in the email where a single sentence can convert a neutral
 * shortcut into a solicitation for a specific score — "Loved it? Leave us 5 stars!" above
 * five clickable stars is textbook review gating, and the app is the party that gets
 * delisted for it, not the merchant.
 *
 * Deliberately a small, specific list rather than sentiment analysis: it catches the phrasing
 * a merchant actually reaches for, it is explainable in the error message, and it cannot
 * silently reject innocent copy. It is a guard rail, not a compliance guarantee.
 */
export function validateEmailStarsPrompt(prompt: string): string | null {
  const matched = GATING_PHRASES.find((pattern) => pattern.test(prompt));
  if (!matched) return null;

  return (
    "The star rating line can't ask for a particular rating — asking for 5 stars or a positive " +
    "review is review gating, which breaks Shopify's App Store rules and FTC guidance. Ask for " +
    "an honest rating instead."
  );
}

// A greeting says "Hi Sarah", not "Hi Sarah Connor" — same extraction the email template used
// inline before Email Studio existed, moved here so both the real send path
// (templates.server.tsx) and the preview path compute {{customer_name}} identically.
export function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}
