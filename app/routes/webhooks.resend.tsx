import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import type { WebhookEventPayload } from "resend";
import { reviewRequestService } from "../services/review-request.server";

// Resend delivers webhooks signed the same way Svix does (svix-id/svix-timestamp/svix-signature
// headers, HMAC-SHA256 over "{id}.{timestamp}.{rawBody}", secret shaped "whsec_<base64>") — see
// https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests. Verified manually here
// rather than pulling in the `svix` package: the algorithm is a handful of lines of the
// platform's own `crypto`, and this app has no other Svix-signed integration that would justify
// a shared dependency.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function verifyResendSignature(
  secret: string,
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
): boolean {
  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuffer = Buffer.from(expected);

  // svix-signature can carry multiple space-separated "v1,<base64>" values (key rotation) —
  // a match against any of them is a valid signature.
  return svixSignature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) => {
      const candidateBuffer = Buffer.from(candidate);
      return (
        candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
      );
    });
}

// The tag review-request.server.ts's dispatchRequestEmail attaches at send time — every
// Resend delivery event echoes it back verbatim, which is how this route finds the right
// ReviewRequest without a separate stored-message-id column. Emails this app sends that were
// never tagged this way (moderation-hold notices, Email Studio test sends) simply have no
// request_token here, and are skipped below — they're not review requests, so there's nothing
// to correlate them to.
function extractRequestToken(event: WebhookEventPayload): string | null {
  const data = event.data as { tags?: Record<string, string> } | undefined;
  return data?.tags?.request_token ?? null;
}

// Receives Resend's delivery-tracking events for review-request emails and reflects them onto
// the matching ReviewRequest row — never creates a ReviewRequest or a Review, only updates a
// status/timestamp on one that already exists (see review-request.server.ts's
// markRequestDelivered/markRequestOpened/markRequestDeliveryFailed, all forward-only and
// idempotent). Every response is either a signature-rejection (401) or an empty 200 — Resend
// retries on non-2xx, so anything we can meaningfully handle (including "unknown request",
// "wrong event type", "processing error") acknowledges with 200 rather than triggering retries
// for something that will never succeed differently next time.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhooks.resend] RESEND_WEBHOOK_SECRET is not configured — rejecting all webhook requests.");
    return new Response("Webhook not configured", { status: 500 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn("[webhooks.resend] Missing signature headers — rejecting.");
    return new Response("Missing signature headers", { status: 401 });
  }

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    console.warn("[webhooks.resend] Signature timestamp outside tolerance — rejecting.");
    return new Response("Signature timestamp outside tolerance", { status: 401 });
  }

  // Read as raw text, not request.json() — signature verification needs the exact bytes
  // Resend signed, which a parse-then-reserialize round trip is not guaranteed to reproduce.
  const rawBody = await request.text();

  if (!verifyResendSignature(secret, rawBody, svixId, svixTimestamp, svixSignature)) {
    console.warn("[webhooks.resend] Invalid signature — rejecting.");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: WebhookEventPayload;
  try {
    event = JSON.parse(rawBody);
  } catch {
    console.warn("[webhooks.resend] Malformed JSON body — rejecting.");
    return new Response("Malformed body", { status: 400 });
  }

  const requestToken = extractRequestToken(event);

  if (!requestToken) {
    console.log(`[webhooks.resend] ${event.type}: no request_token tag on this email, skipping.`);
    return new Response();
  }

  // Logged as a short prefix, never the full token (which is a live, still-usable credential
  // for an unexpired request) or any customer email/name — this route only ever sees what
  // Resend sends it, none of which is logged verbatim below.
  const tokenPrefix = requestToken.slice(0, 8);

  try {
    switch (event.type) {
      case "email.delivered": {
        const changed = await reviewRequestService.markRequestDelivered(requestToken);
        console.log(`[webhooks.resend] email.delivered (token ${tokenPrefix}…): ${changed ? "applied" : "no-op"}`);
        break;
      }
      case "email.opened": {
        const changed = await reviewRequestService.markRequestOpened(requestToken);
        console.log(`[webhooks.resend] email.opened (token ${tokenPrefix}…): ${changed ? "applied" : "no-op"}`);
        break;
      }
      case "email.bounced":
      case "email.complained":
      case "email.failed":
      case "email.suppressed": {
        const changed = await reviewRequestService.markRequestDeliveryFailed(requestToken);
        console.log(`[webhooks.resend] ${event.type} (token ${tokenPrefix}…): ${changed ? "applied" : "no-op"}`);
        break;
      }
      default:
        // email.sent/email.scheduled — we already set "sent" ourselves at actual send time,
        // more immediately than a webhook round trip. email.delivery_delayed — informational
        // only, no status this app tracks changes. email.clicked — Resend's own link-tracking;
        // this app already has a first-party, more direct click signal via r.$token.tsx's
        // markRequestClicked, so this is intentionally not treated as authoritative.
        // email.received/contact.*/domain.* — not relevant to review requests at all.
        break;
    }
  } catch (error) {
    console.error(`[webhooks.resend] Failed to process ${event.type} (token ${tokenPrefix}…):`, error);
  }

  return new Response();
};
