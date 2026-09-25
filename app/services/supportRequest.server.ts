import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { getEmailProvider } from "./notifications/provider.server";
import { buildSupportRequestEmail } from "./notifications/templates.server";
import {
  MESSAGE_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
  SUPPORT_CATEGORIES,
  SUPPORT_INBOX,
  type SupportCategory,
} from "./supportRequest.shared";

// In-app support requests: the merchant writes to IMAGYN from inside the admin, and the server
// sends the mail. Replaces the previous mailto link, which Shopify's embedded iframe blocks
// outright ("This content is blocked") because a mailto: navigation isn't an allowed
// destination for the app frame.
//
// Deliberately NOT a ticketing system: nothing is persisted, no new table, no status tracking.
// One email, sent to one fixed inbox, with the merchant's store as Reply-To so support can
// answer them directly. That is the whole feature.

// The recipient, the category list and the length caps all come from the shared module — the
// form renders from the same constants the server validates against, so the two can't drift.
// The recipient is never read from the request body: a client-supplied recipient would turn
// this authenticated endpoint into an open relay for mail from IMAGYN's own verified domain.
export {
  SUPPORT_INBOX,
  SUPPORT_CATEGORIES,
  SUBJECT_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  type SupportCategory,
} from "./supportRequest.shared";

export class SupportRequestError extends Error {
  constructor(
    message: string,
    /** Distinguishes a merchant-correctable problem (validation, rate limit) from an
     *  infrastructure failure, so the route can answer with the right status code. */
    public readonly kind: "validation" | "rate_limit" | "send_failed",
  ) {
    super(message);
    this.name = "SupportRequestError";
  }
}

// Strips control characters (including the CR/LF pair an attacker would need to inject extra
// SMTP headers through the subject line) while leaving ordinary text, punctuation and
// non-Latin scripts untouched. Newlines are preserved in the message body only — the subject
// collapses them to spaces, since a subject is a single line by definition.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeSingleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(CONTROL_CHARS, "").trim();
}

function sanitizeMultiLine(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(CONTROL_CHARS, "").trim();
}

export interface SupportRequestInput {
  subject: string;
  message: string;
  /** Free-form from the client, but only ever accepted if it matches SUPPORT_CATEGORIES
   *  exactly — anything else is dropped rather than passed through. */
  category?: string | null;
  /** The in-app path the merchant was on. Path only; the route strips any query string before
   *  this is called, since the embedded app's query carries App Bridge session parameters. */
  appSection?: string | null;
}

export interface ValidatedSupportRequest {
  subject: string;
  message: string;
  category: SupportCategory | null;
  appSection: string | null;
}

export function validateSupportRequest(input: SupportRequestInput): ValidatedSupportRequest {
  const subject = sanitizeSingleLine(input.subject ?? "");
  const message = sanitizeMultiLine(input.message ?? "");

  if (!subject) {
    throw new SupportRequestError("Enter a subject.", "validation");
  }
  if (subject.length > SUBJECT_MAX_LENGTH) {
    throw new SupportRequestError(`Keep the subject under ${SUBJECT_MAX_LENGTH} characters.`, "validation");
  }
  if (!message) {
    throw new SupportRequestError("Enter a message.", "validation");
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    throw new SupportRequestError(`Keep the message under ${MESSAGE_MAX_LENGTH} characters.`, "validation");
  }

  const rawCategory = sanitizeSingleLine(input.category ?? "");
  const category = (SUPPORT_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as SupportCategory)
    : null;

  const rawSection = sanitizeSingleLine(input.appSection ?? "");
  // Only an in-app path is ever echoed back into the email — never an absolute URL, which
  // could otherwise carry the embedded session's query parameters.
  const appSection = /^\/[A-Za-z0-9/_-]{0,120}$/.test(rawSection) ? rawSection : null;

  return { subject, message, category, appSection };
}

// Per-store rate limit, held in memory rather than in a new table. The app runs as a single
// long-lived Railway process (the same assumption reviewRequestScheduler.server.ts's in-process
// sweep already relies on), and the consequence of a limit resetting on deploy is simply that a
// merchant may send one extra support email — which is not a security boundary, just abuse
// control. A database table for that would be real persistence the feature does not need.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var supportRequestRateLimit: Map<string, number[]> | undefined;
}

function rateLimitStore(): Map<string, number[]> {
  if (!global.supportRequestRateLimit) {
    global.supportRequestRateLimit = new Map();
  }
  return global.supportRequestRateLimit;
}

export function assertWithinRateLimit(storeId: string, now: number = Date.now()): void {
  const store = rateLimitStore();
  const recent = (store.get(storeId) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    store.set(storeId, recent);
    throw new SupportRequestError(
      "You've sent several support requests recently. Please give us a little time to reply before sending another.",
      "rate_limit",
    );
  }

  recent.push(now);
  store.set(storeId, recent);
}

const SHOP_CONTACT_QUERY = `#graphql
  query SupportContactEmail {
    shop {
      email
    }
  }
`;

// The store's own contact email, used only as Reply-To so support can answer the merchant
// directly. Never shown to the merchant as an editable field, never stored, and never used as
// a recipient. Returns null on any failure — a missing Reply-To must never block a support
// request from being sent.
export async function getShopContactEmail(admin: AdminApiContext): Promise<string | null> {
  try {
    const response = await admin.graphql(SHOP_CONTACT_QUERY);
    const body = (await response.json()) as { data?: { shop?: { email?: string | null } | null } };
    const email = body.data?.shop?.email?.trim();
    return email || null;
  } catch (error) {
    console.error("[supportRequest] Couldn't resolve the shop contact email:", error);
    return null;
  }
}

function formatSubmittedAt(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${formatted} UTC`;
}

export interface SendSupportRequestParams extends ValidatedSupportRequest {
  /** Resolved server-side from the authenticated session — never accepted from the client. */
  storeId: string;
  storeName: string;
  shopDomain: string;
  planName: string | null;
  merchantEmail: string | null;
  now?: Date;
}

// Sends the request. Throws SupportRequestError("send_failed") when the provider fails, so the
// route can tell the merchant to retry with their message still in the form — a support form
// that silently swallows a failure is worse than no form.
export async function sendSupportRequest(params: SendSupportRequestParams): Promise<void> {
  const { subject, html, text } = await buildSupportRequestEmail({
    subject: params.subject,
    message: params.message,
    category: params.category,
    storeName: params.storeName,
    shopDomain: params.shopDomain,
    planName: params.planName,
    appSection: params.appSection,
    merchantEmail: params.merchantEmail,
    submittedAt: formatSubmittedAt(params.now ?? new Date()),
  });

  try {
    await getEmailProvider().sendEmail({
      to: SUPPORT_INBOX,
      subject,
      html,
      text,
      // Lets support hit Reply and reach the merchant. Omitted entirely when the shop has no
      // resolvable contact email, rather than falling back to anything invented.
      ...(params.merchantEmail ? { replyTo: params.merchantEmail } : {}),
    });
  } catch (error) {
    console.error("[supportRequest] Failed to send support request:", error);
    throw new SupportRequestError("We couldn't send your request.", "send_failed");
  }
}
