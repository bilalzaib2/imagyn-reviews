import { Filter } from "bad-words";
import { getStoreById } from "./store.server";
import { getEmailProvider } from "./notifications/provider.server";
import { buildReviewHeldEmail } from "./notifications/templates.server";

export interface ModerationSettings {
  enabled: boolean;
  minRating: number;
  requireVerified: boolean;
  holdLinks: boolean;
  holdProfanity: boolean;
  bannedWords: string[];
  notifyOnHold: boolean;
  notifyEmail: string | null;
}

export interface ModerationInput {
  rating: number;
  title?: string | null;
  content: string;
  verifiedPurchase: boolean;
}

export interface ModerationDecision {
  autoApprove: boolean;
  moderationStatus: "auto_approved" | "held" | null;
  moderationReason: string | null;
}

// One phrase per line, as entered in the Settings textarea — never stored as a separate
// table since it's always read/written as one whole list (see Store.moderationBannedWords).
export function parseBannedWords(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((word) => word.trim())
    .filter(Boolean);
}

// Deliberately simple (scheme or "www." prefix only) rather than a bare-domain matcher —
// a review that happens to mention "acme.com" in passing shouldn't be held just for
// containing a dot-separated word, only a review that contains an actual clickable-looking link.
const LINK_PATTERN = /(https?:\/\/|www\.)\S+/i;

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text);
}

// One shared Filter instance — bad-words' default wordlist plus nothing extra; merchant-
// specific terms are handled separately by findBannedWord/moderationBannedWords instead of
// being added to this filter, since they're a different concept (a hold rule that also
// generates its own quoted reason, not a "this text is generically profane" verdict).
const profanityFilter = new Filter();

export function containsProfanity(text: string): boolean {
  return profanityFilter.isProfane(text);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findBannedWord(text: string, bannedWords: string[]): string | null {
  const lower = text.toLowerCase();

  for (const word of bannedWords) {
    if (!word) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(word.toLowerCase())}\\b`);
    if (pattern.test(lower)) {
      return word;
    }
  }

  return null;
}

export async function getModerationSettings(storeId: string): Promise<ModerationSettings> {
  const store = await getStoreById(storeId);

  if (!store) {
    throw new Error("Store not found.");
  }

  return {
    enabled: store.moderationRulesEnabled,
    minRating: store.moderationMinRating,
    requireVerified: store.moderationRequireVerified,
    holdLinks: store.moderationHoldLinks,
    holdProfanity: store.moderationHoldProfanity,
    bannedWords: parseBannedWords(store.moderationBannedWords),
    notifyOnHold: store.moderationNotifyOnHold,
    notifyEmail: store.moderationNotifyEmail,
  };
}

// The single decision point the submission pipeline (api.reviews.tsx, r.$token.tsx) calls
// before createReview(). Hold rules always win over auto-approve — a review that would
// otherwise qualify (high rating, verified buyer) still gets held if it also contains a
// link, profanity, or a banned word, since those are trust/safety signals, not quality ones.
export function evaluateReview(settings: ModerationSettings, input: ModerationInput): ModerationDecision {
  if (!settings.enabled) {
    return { autoApprove: false, moderationStatus: null, moderationReason: null };
  }

  const scanText = [input.title, input.content].filter(Boolean).join("\n");

  if (settings.holdLinks && containsLink(scanText)) {
    return { autoApprove: false, moderationStatus: "held", moderationReason: "Held: review contains a link" };
  }

  if (settings.holdProfanity && containsProfanity(scanText)) {
    return { autoApprove: false, moderationStatus: "held", moderationReason: "Held: review contains profanity" };
  }

  const bannedWord = findBannedWord(scanText, settings.bannedWords);
  if (bannedWord) {
    return {
      autoApprove: false,
      moderationStatus: "held",
      moderationReason: `Held: review contains the banned word "${bannedWord}"`,
    };
  }

  const meetsRating = input.rating >= settings.minRating;
  const meetsVerification = !settings.requireVerified || input.verifiedPurchase;

  if (meetsRating && meetsVerification) {
    return {
      autoApprove: true,
      moderationStatus: "auto_approved",
      moderationReason: `Auto-approved: ${input.rating}★ meets the ${settings.minRating}★ minimum${
        settings.requireVerified ? " and is a verified buyer" : ""
      }`,
    };
  }

  return { autoApprove: false, moderationStatus: null, moderationReason: null };
}

// Fire-and-forget from the calling route (mirrors setReviewStatus's
// maybeAutoRegenerateAiSummary pattern in review.server.ts) — a notification-send failure
// must never affect a review submission that has already succeeded, so every failure is
// caught and logged here rather than propagated.
export async function sendHeldReviewNotification(params: {
  storeName: string;
  notifyEmail: string;
  reviewerName: string;
  productName: string;
  rating: number;
  reason: string;
}): Promise<void> {
  try {
    const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
    const reviewsUrl = `${appUrl}/app/reviews?status=PENDING`;

    const { subject, html, text } = await buildReviewHeldEmail({
      storeName: params.storeName,
      reviewerName: params.reviewerName,
      productName: params.productName,
      rating: params.rating,
      reason: params.reason,
      reviewsUrl,
    });

    await getEmailProvider().sendEmail({ to: params.notifyEmail, subject, html, text });
  } catch (error) {
    console.error("Failed to send held-review notification email:", error);
  }
}
