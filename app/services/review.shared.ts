export const ReviewStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

/**
 * Why a merchant hid a review.
 *
 * A fixed list, not free text. Three reasons:
 *
 *   - It is a consumer-protection expectation that a hidden review has a stated,
 *     categorisable reason. Free text cannot be aggregated, audited or translated, and in
 *     practice collects "" and "spam lol".
 *   - The storefront must never show these. They are an internal moderation record.
 *   - The Spam view is simply a filter over this column, so the ids have to be stable.
 *
 * Ids are stored; labels are presentation and may be reworded freely. Taken from the
 * categories the benchmark uses, which are themselves drawn from the platform policies both
 * apps answer to.
 */
export const REVIEW_HIDE_REASONS = [
  { id: "spam", label: "Spam" },
  { id: "fake", label: "Fake or not a genuine customer" },
  { id: "duplicate", label: "Duplicate review" },
  { id: "unrelated", label: "Unrelated to the product" },
  { id: "offensive", label: "Offensive or inappropriate" },
  { id: "personal_data", label: "Contains personal information" },
  { id: "other", label: "Other" },
] as const;

export type ReviewHideReasonId = (typeof REVIEW_HIDE_REASONS)[number]["id"];

const HIDE_REASON_IDS: ReadonlySet<string> = new Set(REVIEW_HIDE_REASONS.map((reason) => reason.id));

/** True when `value` is one of the fixed reason ids. */
export function isReviewHideReason(value: unknown): value is ReviewHideReasonId {
  return typeof value === "string" && HIDE_REASON_IDS.has(value);
}

/**
 * Narrows arbitrary input to a storable reason id.
 *
 * Returns null for anything unrecognised rather than throwing or inventing "other": a reason
 * the app did not offer is not a reason the merchant chose, and silently recording it as
 * "Other" would put words in their mouth in a record that exists for accountability.
 */
export function parseReviewHideReason(value: unknown): ReviewHideReasonId | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isReviewHideReason(trimmed) ? trimmed : null;
}

/** The merchant-facing label for a stored id, or null if the id is not one we offer. */
export function reviewHideReasonLabel(id: unknown): string | null {
  return REVIEW_HIDE_REASONS.find((reason) => reason.id === id)?.label ?? null;
}

/**
 * The rows a review may count toward anywhere public: not soft-deleted, not archived.
 *
 * Lives here, in the import-free shared module, because five separate services build their
 * own review queries and a cycle would form if they each reached into review.server.ts. The
 * failure it prevents is silent in every one of them — a public read or a statistic that
 * forgets `archivedAt` keeps showing and counting an archived review, and nothing throws.
 */
export const LIVE_REVIEW = { deletedAt: null, archivedAt: null } as const;

export const HelpfulVoteValue = {
  HELPFUL: "HELPFUL",
  NOT_HELPFUL: "NOT_HELPFUL",
} as const;

export type HelpfulVoteValue = (typeof HelpfulVoteValue)[keyof typeof HelpfulVoteValue];

/** The longest auto-suggested headline. Matches the `maxLength` on the headline input, so a
 *  suggestion can never be longer than the field would accept. */
export const SUGGESTED_TITLE_MAX_LENGTH = 120;

/**
 * Derives a headline suggestion from the body of a review.
 *
 * Judge.me parity (audit §4.2, "Title auto-fill from body"). The headline is optional in this
 * app and most customers leave it blank, which costs the merchant the scannable one-line
 * summary that makes a review widget readable — so the first sentence is offered as a
 * starting point.
 *
 * SUGGESTED, never imposed. The caller only applies this while the customer has not typed a
 * headline themselves, and the field stays fully editable — see r.$token.tsx. Nothing here
 * writes to a review; this is a pure string function.
 *
 * Returns null rather than a bad guess when there is nothing worth suggesting: too little
 * text to summarise, or a first sentence so long that truncating it would produce a headline
 * ending mid-word. A blank headline is a better outcome than a mangled one.
 */
export function suggestReviewTitle(body: string): string | null {
  const text = body.trim().replace(/\s+/g, " ");

  // Under ~25 characters there is no summary to make — the body IS the summary, and repeating
  // it as the headline just prints the same sentence twice in the widget.
  if (text.length < 25) return null;

  // First sentence: terminal punctuation followed either by the end of the string, or by a
  // space and then something that actually starts a new sentence — an opening quote or a
  // capital letter.
  //
  // Both halves of that condition are load-bearing, and each one exists for a real failure:
  //
  //   "Arrived in 2.5 days."            a decimal point has no space after it, so requiring
  //                                     whitespace already rules it out.
  //   "Runs small, i.e. order a size"   an abbreviation DOES have a space after it. Only the
  //                                     capital-letter requirement rejects this one — "order"
  //                                     is lowercase, so the sentence continues. Without it,
  //                                     this review's headline would be "Runs small, i.e".
  //
  // It is a heuristic, not a parser. A body that genuinely begins a sentence with a lowercase
  // word gets a longer headline than it should, which the customer can edit; the opposite
  // error — a headline cut to three characters — is the one worth engineering against.
  const match = text.match(/^(.+?[.!?])(?:\s+(?=[“"'([A-Z])|$)/);
  const firstSentence = (match ? match[1] : text).trim();

  // Trailing punctuation is dropped: a headline is a label, not a sentence, and "Great fit"
  // reads better than "Great fit!" once the widget adds its own styling.
  const headline = firstSentence.replace(/[.!?]+$/, "").trim();

  // Rejects a degenerate fragment — "Yes", "No", "Ok", "Nice" — which says nothing as a
  // headline even though the body it came from is long enough to be worth summarising. Six
  // rather than ten characters, so a real short headline ("So good", "Lovely", "Superb")
  // still gets through; the body-length gate above is what handles "the body IS the summary".
  if (headline.length < 6) return null;
  if (headline.length <= SUGGESTED_TITLE_MAX_LENGTH) return headline;

  // Too long: cut at the last word boundary that fits rather than mid-word. If that leaves
  // less than half the budget, there was no clean break to make and nothing is suggested.
  const clipped = headline.slice(0, SUGGESTED_TITLE_MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(" ");
  if (lastSpace < SUGGESTED_TITLE_MAX_LENGTH / 2) return null;

  return clipped.slice(0, lastSpace).trim();
}
