// Values shared by the support form (client) and the send path (server). Same `.shared.ts`
// convention as email.shared.ts / widget.shared.ts / appearance.shared.ts: anything a React
// component needs lives here so the component never imports a `.server` module, which would
// drag server-only code into the client bundle.

// The one and only support recipient. Duplicated nowhere: supportRequest.server.ts re-exports
// this rather than declaring its own copy, so the address a merchant is told about and the
// address the server actually sends to can never drift apart.
export const SUPPORT_INBOX = "support@reviews.imagyn.co";

export const SUPPORT_CATEGORIES = [
  "General Question",
  "Technical Issue",
  "Review Requests",
  "Widgets",
  "Billing",
  "Other",
] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUBJECT_MAX_LENGTH = 200;
export const MESSAGE_MAX_LENGTH = 5000;

/** The shape app.support.tsx's action answers with, declared here so the form can type its
 *  fetcher without importing the route module itself. */
export type SupportActionData = {
  ok: boolean;
  error?: string;
};
