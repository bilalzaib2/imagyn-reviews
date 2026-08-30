// Imagyn Reviews — Email Studio content contract.
//
// The merchant-editable content for the review-request email (emails/ReviewRequestEmail.tsx).
// Same JSON-as-String-column precedent as appearance.shared.ts's AppearanceTokens — a small,
// curated set of fields (not a raw HTML editor) so the email stays a real, cross-client-safe
// React Email template underneath, and so the contract can grow without a migration per field.
//
// Free vs Pro (see app/services/permissions.ts's canUseEmailReminders/canUseAdvancedEmailStudio/
// canUseCustomBranding and app/routes/app.email-studio.tsx): every field below except
// showPoweredBy is available on every plan, for every template type. The Review Request
// template is available on every plan; the two reminder templates and the reward template
// (see EmailTemplateType) are Pro-only, gated by canUseEmailReminders/canUseAutomaticReviewRequests
// respectively. showPoweredBy is the one Pro-gated *field* — see sanitizeEmailTemplateContentForPlan,
// the actual server-side enforcement point (a Free store can never persist false here, no
// matter what a direct POST claims). Deeper layout/styling control beyond these fields
// remains Pro-only and not built yet (canUseAdvancedEmailStudio, still a no-op today).

export interface EmailTemplateContent {
  /** Supports {{variables}} — see EMAIL_TEMPLATE_VARIABLES below. */
  subject: string;
  /** The large heading line at the top of the email body. Supports {{variables}}. */
  heading: string;
  /** The paragraph beneath the heading. Supports {{variables}}. */
  bodyText: string;
  /** Text on the review CTA button. Does not support variables — kept short and literal. */
  buttonText: string;
  /** Hex color for the CTA button background. */
  accentColor: string;
  /** null = no logo shown — the store-name eyebrow line (below) is what identifies the
   *  sender when there's no logo; merchant-uploaded via Email Studio's own upload control
   *  (stored through Shopify's Files API, see storage/shopifyFiles.server.ts), always
   *  clearable. */
  logoUrl: string | null;
  /** null/empty = show the real Shopify store name. Lets a merchant show a friendlier or
   *  shorter name inside the email body (the eyebrow line and the {{store_name}} variable)
   *  without changing the actual sender identity — the From header always uses the real
   *  store name regardless of this override (see resend.server.ts's fromName). */
  displayName: string | null;
  /** Hides the store-name eyebrow line entirely when false. Independent of displayName —
   *  a merchant can keep {{store_name}} in their own copy while still removing the eyebrow. */
  showStoreName: boolean;
  /** The small "Powered by Imagyn Reviews" footer line (see ReviewRequestEmail.tsx). Always
   *  true on Free — see sanitizeEmailTemplateContentForPlan, which force-overwrites this to
   *  true for any store without canUseCustomBranding, regardless of what's persisted here or
   *  what a direct POST claims. Pro stores may set this false to remove it. */
  showPoweredBy: boolean;
}

export const DEFAULT_ACCENT_COLOR = "#111111";

// One row per (store, type) in EmailTemplate — "review_request" is the Day-0 send every store
// gets; "reminder_1"/"reminder_final" back the fixed 3-day/7-day Automatic Reminder Emails
// (see reviewRequestScheduler.server.ts's runDueReminderSweep); "reward" backs Review
// Rewards' customer-communication step (see rewards.server.ts's evaluateAndIssueReward) —
// sent only after a real Shopify discount code has actually been created, never before.
// Defined here, not emailTemplate.server.ts, since this is the content contract's own type
// union — the service layer imports it, not the other way around.
export type EmailTemplateType = "review_request" | "reminder_1" | "reminder_final" | "reward";

export function getDefaultEmailTemplateContent(type: EmailTemplateType = "review_request"): EmailTemplateContent {
  if (type === "reward") {
    return {
      subject: "Thank you for your review — here's {{discount_code}}",
      heading: "Thanks for your review, {{customer_name}}!",
      bodyText: "As a thank you for sharing your thoughts on {{product_name}}, here's a discount code for your next order.",
      buttonText: "Shop now",
      accentColor: DEFAULT_ACCENT_COLOR,
      logoUrl: null,
      displayName: null,
      showStoreName: true,
      showPoweredBy: true,
    };
  }

  if (type === "reminder_1") {
    return {
      subject: "Still thinking it over? We'd love your thoughts on {{product_name}}",
      heading: "Hi {{customer_name}}, got a minute for {{product_name}}?",
      bodyText: "We haven't heard from you yet — your review helps other shoppers, and it only takes a minute.",
      buttonText: "Write a review",
      accentColor: DEFAULT_ACCENT_COLOR,
      logoUrl: null,
      displayName: null,
      showStoreName: true,
      showPoweredBy: true,
    };
  }

  if (type === "reminder_final") {
    return {
      subject: "Last call — share your thoughts on {{product_name}}",
      heading: "One last time, {{customer_name}} — how was {{product_name}}?",
      bodyText: "This is our final reminder. We'd still love to hear what you think, if you have a moment.",
      buttonText: "Write a review",
      accentColor: DEFAULT_ACCENT_COLOR,
      logoUrl: null,
      displayName: null,
      showStoreName: true,
      showPoweredBy: true,
    };
  }

  return {
    subject: "How was your {{product_name}}?",
    heading: "Hi {{customer_name}}, how was your {{product_name}}?",
    bodyText: "Your feedback helps other shoppers decide with confidence — it only takes a minute.",
    buttonText: "Write a review",
    accentColor: DEFAULT_ACCENT_COLOR,
    logoUrl: null,
    displayName: null,
    showStoreName: true,
    showPoweredBy: true,
  };
}

// Merges a partial/legacy-shaped record (e.g. after a future field is added) over the current
// defaults, the same tolerant-upgrade pattern mergeAppearanceTokens already established — a
// row saved before a new field existed should never crash the reader, just fall back per-field.
// `type` picks which template's defaults back-fill any missing field, so a partially-saved
// reminder template never silently reverts a missing field to the review-request copy.
export function mergeEmailTemplateContent(
  partial: Partial<EmailTemplateContent>,
  type: EmailTemplateType = "review_request",
): EmailTemplateContent {
  return { ...getDefaultEmailTemplateContent(type), ...partial };
}

// The server-side enforcement point for canUseAdvancedEmailStudio/canUseCustomBranding (see
// permissions.ts) — app.email-studio.tsx's save action must call this before persisting,
// exactly like app.appearance.tsx's save action strips Pro-only Brand Studio fields for Free
// stores, rather than trusting that the UI never sent them. Every field except showPoweredBy
// is base functionality available on every plan for every template type. showPoweredBy is
// real Pro-gated behavior: force-overwritten to true for any store without
// canUseCustomBranding, regardless of what's persisted or what a direct POST claims — a Free
// store can never make the "Powered by Imagyn" footer disappear by any path. (Whether a
// merchant can save a reminder-/reward-type template at all is gated separately, by
// canUseEmailReminders/canUseAutomaticReviewRequests, in app.email-studio.tsx's own action —
// not here.) canUseAdvancedEmailStudio is accepted now, ahead of having anything to gate, so
// this is the one place a future deeper-styling field gets threaded in — the day one ships,
// it's added to the allow-list below guarded by this flag, not left to a UI-only check.
export function sanitizeEmailTemplateContentForPlan(
  content: EmailTemplateContent,
  permissions: { canUseAdvancedEmailStudio: boolean; canUseCustomBranding: boolean },
): EmailTemplateContent {
  void permissions.canUseAdvancedEmailStudio;
  return {
    subject: content.subject,
    heading: content.heading,
    bodyText: content.bodyText,
    buttonText: content.buttonText,
    accentColor: content.accentColor,
    logoUrl: content.logoUrl,
    displayName: content.displayName,
    showStoreName: content.showStoreName,
    showPoweredBy: permissions.canUseCustomBranding ? content.showPoweredBy : true,
  };
}

export interface EmailTemplateVariableValues {
  customerName: string;
  storeName: string;
  productName: string;
  /** Reward emails only — the real, already-issued Shopify discount code. Absent (never
   *  substituted) for every other template type, since no other send has one. */
  discountCode?: string;
}

// The variables Email Studio exposes — each maps 1:1 to data the sender already has on hand
// (ReviewRequestRecord.name/store.name/product.name, or the just-issued Reward's discountCode),
// so no new data flow is needed to support them. `token` is what the merchant types/inserts;
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

// Plain {{token}} replacement, not a templating engine — deliberately so: the input is
// merchant-authored free text, never executed, and the only tokens that can ever appear are
// the ones declared above. Unknown/malformed tokens are left as literal text rather than
// throwing, so a merchant's typo never breaks a live send.
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

// A greeting says "Hi Sarah", not "Hi Sarah Connor" — same extraction the email template used
// inline before Email Studio existed, moved here so both the real send path
// (templates.server.tsx) and any future preview path compute {{customer_name}} identically.
export function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}
