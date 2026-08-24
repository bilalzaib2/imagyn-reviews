// Email unsubscribe/suppression — checked by review-request.server.ts's dispatchRequestEmail
// and dispatchReminderEmail before every automated send. See EmailSuppression in
// prisma/schema.prisma for why this is keyed by (store, email) rather than by ReviewRequest.

import crypto from "node:crypto";
import prisma from "../db.server";

// Namespaces this HMAC use away from any other possible use of SHOPIFY_API_SECRET elsewhere in
// the app (Shopify's own OAuth/session/webhook signing) — reusing the app's own required secret
// avoids provisioning a new deployment dependency, a deliberate product decision for this
// feature (see DECISIONS.md).
const HMAC_NAMESPACE = "unsubscribe";

// Emails are compared/stored case-insensitively so a differently-cased resend of the same
// address can't bypass a prior unsubscribe, and so a token generated for one casing still
// verifies against another.
const normalizeEmail = (email: string) => email.trim().toLowerCase();

function getSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    // This app cannot run at all without SHOPIFY_API_SECRET (required by shopify.server.ts's
    // own app config), so this is a genuine misconfiguration, not a normal runtime path.
    throw new Error("SHOPIFY_API_SECRET is not configured — required for unsubscribe token signing.");
  }
  return secret;
}

// Stateless — no token needs to exist in the database before an email carrying it is sent.
// Deterministic from (storeId, email) + the server secret, so it can be recomputed and verified
// on the incoming request without a prior lookup.
export function generateUnsubscribeToken(storeId: string, email: string): string {
  const message = `${HMAC_NAMESPACE}:${storeId}:${normalizeEmail(email)}`;
  return crypto.createHmac("sha256", getSecret()).update(message).digest("hex");
}

// Constant-time comparison (crypto.timingSafeEqual) — same defensive pattern already
// established in webhooks.resend.tsx's signature verification. Returns false (never throws) for
// any malformed/mismatched-length token, so a caller never needs its own try/catch.
export function verifyUnsubscribeToken(storeId: string, email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(storeId, email);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(token);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export function buildUnsubscribeUrl(storeId: string, email: string): string {
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL || "http://127.0.0.1:3000";
  const token = generateUnsubscribeToken(storeId, email);
  const params = new URLSearchParams({ store: storeId, email, token });
  return `${appUrl.replace(/\/$/, "")}/unsubscribe?${params.toString()}`;
}

export const emailSuppressionService = {
  // Called by dispatchRequestEmail/dispatchReminderEmail before every automated send — null
  // email (already guarded elsewhere) is never suppressed, same "nothing to check" convention
  // those functions already use for a missing email/token.
  async isSuppressed(storeId: string, email: string | null): Promise<boolean> {
    if (!email) {
      return false;
    }

    const row = await prisma.emailSuppression.findUnique({
      where: { storeId_email: { storeId, email: normalizeEmail(email) } },
    });

    return row !== null;
  },

  // Idempotent — upsert with an empty update, so re-unsubscribing (e.g. a customer clicking an
  // old email's link twice) never errors and never creates a duplicate row (the (storeId,
  // email) unique constraint would reject a plain create on a second call).
  async suppress(storeId: string, email: string, source: string = "unsubscribe_link"): Promise<void> {
    const normalized = normalizeEmail(email);

    await prisma.emailSuppression.upsert({
      where: { storeId_email: { storeId, email: normalized } },
      update: {},
      create: { storeId, email: normalized, source },
    });
  },
};
