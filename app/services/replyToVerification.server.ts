// Verified Reply-To (Pro) — proving a merchant can read the inbox replies will be sent to.
//
// SCOPE, STATED PLAINLY: this verifies only that someone with access to the address clicked
// a link we emailed there. It is NOT domain authentication. It does not touch SPF, DKIM,
// DMARC or BIMI, it does not change the From address, and it must never be described to a
// merchant as verifying their sending domain. The From address stays on the platform's
// verified Resend domain for every plan (see emailSenderIdentity.server.ts).
//
// Security properties:
//   * The token is random (32 bytes, base64url) and only its SHA-256 digest is stored, so a
//     database leak yields no usable verification link.
//   * Single use — the hash is cleared the moment it is consumed.
//   * Expiring — VERIFICATION_TTL_MS after it was sent.
//   * Constant-time comparison, so the stored digest cannot be probed byte by byte.
//   * Changing the address clears any existing verification, so a new, unproven address can
//     never inherit the previous one's verified status.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "../db.server";

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Minimum gap between verification sends for one store. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

// Deliberately strict-but-ordinary. Anything exotic enough to fail this is also likely to
// fail at the mailbox provider, and a Reply-To header is not the place to be adventurous.
const EMAIL_PATTERN = /^[^\s@,<>"]+@[^\s@,<>"]+\.[A-Za-z]{2,}$/;

export type ReplyToState = "none" | "pending" | "verified";

export interface ReplyToStatus {
  email: string | null;
  state: ReplyToState;
  verifiedAt: Date | null;
  /** When the pending token stops working. */
  expiresAt: Date | null;
  /** Whether a new verification email may be sent right now. */
  canResend: boolean;
  /** Seconds until a resend is allowed, when it is not. */
  resendAvailableInSeconds: number;
}

export function isValidReplyToEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed);
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Equal-length constant-time compare that cannot throw on a length mismatch. */
export function tokenMatchesHash(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const candidate = Buffer.from(hashVerificationToken(token), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

export interface StoreReplyToFields {
  replyToEmail: string | null;
  replyToVerifiedAt: Date | null;
  replyToTokenHash: string | null;
  replyToTokenExpiresAt: Date | null;
  replyToTokenSentAt: Date | null;
}

export function describeReplyTo(store: StoreReplyToFields, now: Date = new Date()): ReplyToStatus {
  const elapsed = store.replyToTokenSentAt ? now.getTime() - store.replyToTokenSentAt.getTime() : Infinity;
  const waitMs = Math.max(0, RESEND_COOLDOWN_MS - elapsed);

  let state: ReplyToState = "none";
  if (store.replyToEmail) state = store.replyToVerifiedAt ? "verified" : "pending";

  return {
    email: store.replyToEmail,
    state,
    verifiedAt: store.replyToVerifiedAt,
    expiresAt: store.replyToTokenExpiresAt,
    canResend: waitMs === 0,
    resendAvailableInSeconds: Math.ceil(waitMs / 1000),
  };
}

export interface StartVerificationResult {
  ok: boolean;
  error?: string;
  /** The raw token — emailed to the merchant, never persisted and never logged. */
  token?: string;
  email?: string;
}

/**
 * Saves the address (unverified) and issues a fresh single-use token.
 *
 * Saving is never the same thing as verifying: the address is stored so the merchant can see
 * what is pending, but replyToVerifiedAt stays null until the link is clicked.
 */
export async function startReplyToVerification(
  storeId: string,
  rawEmail: string,
  now: Date = new Date(),
): Promise<StartVerificationResult> {
  const email = rawEmail.trim();

  if (!isValidReplyToEmail(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      replyToEmail: true,
      replyToVerifiedAt: true,
      replyToTokenHash: true,
      replyToTokenExpiresAt: true,
      replyToTokenSentAt: true,
    },
  });
  if (!store) return { ok: false, error: "Store not found." };

  // Rate limit applies to re-requesting the SAME address. A different address is a new
  // intent, not a resend, so it is not throttled by the previous one.
  const sameAddress = store.replyToEmail?.toLowerCase() === email.toLowerCase();
  const status = describeReplyTo(store, now);
  if (sameAddress && !status.canResend) {
    return {
      ok: false,
      error: `Please wait ${status.resendAvailableInSeconds}s before requesting another verification email.`,
    };
  }

  const token = randomBytes(32).toString("base64url");

  await prisma.store.update({
    where: { id: storeId },
    data: {
      replyToEmail: email,
      // Any change — including re-verifying the same address — invalidates the old proof.
      // An address is never treated as verified on the strength of a previous address.
      replyToVerifiedAt: null,
      replyToTokenHash: hashVerificationToken(token),
      replyToTokenExpiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
      replyToTokenSentAt: now,
    },
  });

  return { ok: true, token, email };
}

export type VerifyOutcome = "verified" | "invalid" | "expired" | "already-verified";

/**
 * Consumes a token. Single use: the hash is cleared whether it succeeds or expires, so a
 * link cannot be replayed and an expired one cannot be retried into working.
 */
export async function completeReplyToVerification(
  storeId: string,
  token: string,
  now: Date = new Date(),
): Promise<VerifyOutcome> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      replyToEmail: true,
      replyToVerifiedAt: true,
      replyToTokenHash: true,
      replyToTokenExpiresAt: true,
      replyToTokenSentAt: true,
    },
  });
  if (!store) return "invalid";

  if (!store.replyToTokenHash) {
    // Nothing pending. Already-verified is reported distinctly so a merchant who clicks the
    // link twice sees reassurance rather than a scary failure.
    return store.replyToVerifiedAt ? "already-verified" : "invalid";
  }

  if (!tokenMatchesHash(token, store.replyToTokenHash)) return "invalid";

  if (!store.replyToTokenExpiresAt || store.replyToTokenExpiresAt.getTime() <= now.getTime()) {
    await prisma.store.update({
      where: { id: storeId },
      data: { replyToTokenHash: null, replyToTokenExpiresAt: null },
    });
    return "expired";
  }

  await prisma.store.update({
    where: { id: storeId },
    data: { replyToVerifiedAt: now, replyToTokenHash: null, replyToTokenExpiresAt: null },
  });

  return "verified";
}

/** Removes the address and every trace of its verification. */
export async function clearReplyTo(storeId: string): Promise<void> {
  await prisma.store.update({
    where: { id: storeId },
    data: {
      replyToEmail: null,
      replyToVerifiedAt: null,
      replyToTokenHash: null,
      replyToTokenExpiresAt: null,
      replyToTokenSentAt: null,
    },
  });
}
