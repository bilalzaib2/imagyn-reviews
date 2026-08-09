// Imagyn Reviews — Email Studio content contract.
//
// The merchant-editable content for the review-request email (emails/ReviewRequestEmail.tsx).
// Same JSON-as-String-column precedent as appearance.shared.ts's AppearanceTokens — a small,
// curated set of fields (not a raw HTML editor) so the email stays a real, cross-client-safe
// React Email template underneath, and so the contract can grow without a migration per field.
//
// Free vs Pro (see app/services/permissions.ts's canUseAdvancedEmailStudio and
// app/routes/app.email-studio.tsx): every field below is available on every plan. Multiple
// templates/themes, a reminder-email variant, and deeper layout/styling control are Pro-only
// and not built yet — see EmailTemplate.type in prisma/schema.prisma for how that's meant to
// extend this same model later, additively.

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
  /** null = no logo shown. Set from Shopify's own shop.brand.logo by default (see
   *  app.email-studio.tsx's loader) but always merchant-editable/clearable. */
  logoUrl: string | null;
}

export const DEFAULT_ACCENT_COLOR = "#111111";

export function getDefaultEmailTemplateContent(): EmailTemplateContent {
  return {
    subject: "How was your {{product_name}}?",
    heading: "Hi {{customer_name}}, how was your {{product_name}}?",
    bodyText: "Your feedback helps other shoppers decide with confidence — it only takes a minute.",
    buttonText: "Write a review",
    accentColor: DEFAULT_ACCENT_COLOR,
    logoUrl: null,
  };
}

// Merges a partial/legacy-shaped record (e.g. after a future field is added) over the current
// defaults, the same tolerant-upgrade pattern mergeAppearanceTokens already established — a
// row saved before a new field existed should never crash the reader, just fall back per-field.
export function mergeEmailTemplateContent(partial: Partial<EmailTemplateContent>): EmailTemplateContent {
  return { ...getDefaultEmailTemplateContent(), ...partial };
}

export interface EmailTemplateVariableValues {
  customerName: string;
  storeName: string;
  productName: string;
}

// The only variables Email Studio exposes — each maps 1:1 to data dispatchRequestEmail already
// has on hand (ReviewRequestRecord.name/store.name/product.name), so no new data flow is
// needed to support them. `token` is what the merchant types/inserts; `describe` is the label
// shown in the editor's "Insert variable" control.
export const EMAIL_TEMPLATE_VARIABLES: Array<{ token: string; describe: string }> = [
  { token: "{{customer_name}}", describe: "Customer's first name" },
  { token: "{{store_name}}", describe: "Store name" },
  { token: "{{product_name}}", describe: "Product name" },
];

// Plain {{token}} replacement, not a templating engine — deliberately so: the input is
// merchant-authored free text, never executed, and the only tokens that can ever appear are
// the three declared above. Unknown/malformed tokens are left as literal text rather than
// throwing, so a merchant's typo never breaks a live send.
export function renderTemplateVariables(text: string, values: EmailTemplateVariableValues): string {
  return text
    .replaceAll("{{customer_name}}", values.customerName)
    .replaceAll("{{store_name}}", values.storeName)
    .replaceAll("{{product_name}}", values.productName);
}

// A greeting says "Hi Sarah", not "Hi Sarah Connor" — same extraction the email template used
// inline before Email Studio existed, moved here so both the real send path
// (templates.server.tsx) and any future preview path compute {{customer_name}} identically.
export function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}
