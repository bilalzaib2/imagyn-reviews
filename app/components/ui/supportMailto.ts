// The one place the support address and the shape of a support email are defined. Extracted
// from FloatingHelp.tsx (rather than inlined there) for two reasons: the address must have a
// single source of truth, and what does or doesn't end up in a support email body is a real
// privacy decision that deserves its own tests.
export const SUPPORT_EMAIL = "appsupport@imagyn.co";

export interface SupportContext {
  /** The store's display name, as the app already knows it (Store.name). */
  storeName: string | null;
  /** The myshopify.com domain — identifying, but not secret: it's in the URL of every page of
   *  the merchant's own admin. */
  shopDomain: string | null;
  /** The merchant-facing plan name ("Free"/"Pro"), when resolvable. */
  planName: string | null;
  /** The in-app path the merchant was on when they opened the panel (e.g. "/app/reviews") —
   *  never the full URL, which carries the embedded app's session/host query parameters. */
  path: string | null;
}

// Deliberately NOT included here, and the reason this is a narrow, explicit builder rather
// than something that serializes a context object wholesale: no access token, API key, session
// token, App Bridge `host`/`id_token`/`hmac` parameter, customer name, customer email, review
// content, or any other end-customer data ever goes into a support email. The four fields above
// are the complete set — a merchant who wants to describe their issue writes it themselves in
// the space the body leaves for them.
export function buildSupportSubject(context: Pick<SupportContext, "storeName">): string {
  return context.storeName
    ? `IMAGYN Reviews Support — ${context.storeName}`
    : "IMAGYN Reviews Support";
}

export function buildSupportBody(context: SupportContext): string {
  const lines: string[] = ["", "", "---", "Store details (added automatically):"];

  if (context.storeName) {
    lines.push(`Store: ${context.storeName}`);
  }
  if (context.shopDomain) {
    lines.push(`Shop: ${context.shopDomain}`);
  }
  if (context.planName) {
    lines.push(`Plan: ${context.planName}`);
  }
  if (context.path) {
    lines.push(`Page: ${context.path}`);
  }

  return lines.join("\n");
}

// mailto URLs percent-encode subject/body; newlines in the body must be encoded too, which
// encodeURIComponent handles. No `to` is ever taken from a parameter — it is always
// SUPPORT_EMAIL — so this can't be pointed at another address by a caller.
export function buildSupportMailto(context: SupportContext): string {
  const subject = encodeURIComponent(buildSupportSubject(context));
  const body = encodeURIComponent(buildSupportBody(context));
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}

// Feedback is the same inbox, distinguished by subject line — a small app has one support
// inbox, not two. Carries no store context in the body: product feedback needs none, and the
// less that leaves the app automatically, the better.
export function buildFeedbackMailto(context: Pick<SupportContext, "storeName">): string {
  const subject = encodeURIComponent(
    context.storeName ? `IMAGYN Reviews Feedback — ${context.storeName}` : "IMAGYN Reviews Feedback",
  );
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}`;
}
