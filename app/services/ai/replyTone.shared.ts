// AI reply tone — the shared, client-safe half.
//
// Separate from types.ts (which the providers import) and from the provider modules (which are
// server-only) because the Reviews screen needs the list, the labels and the type guard in the
// browser. Same split as email.shared.ts / review.shared.ts: the contract and its UI copy live
// in a .shared module, the implementation stays on the server.
//
// Nothing in here imports a provider, an SDK or Prisma, so pulling it into a route's client
// bundle costs nothing.
import type { AiReplyTone } from "./types";

export type { AiReplyTone };

/** The closed set, in the order the selector shows them. "friendly" is first because it is
 *  the default — the voice this app used before tone was configurable. */
export const AI_REPLY_TONES: readonly AiReplyTone[] = ["friendly", "direct", "elegant"];

export const DEFAULT_AI_REPLY_TONE: AiReplyTone = "friendly";

/**
 * Narrows a value posted from a form.
 *
 * The result reaches a system prompt, so this is a real boundary rather than a convenience:
 * an unrecognised string must fall back to the default voice, never be forwarded to the
 * model. That is why tone is an enum at all instead of a free-text "write in this style"
 * field, which would be a prompt-injection surface on a merchant-editable value.
 */
export function isAiReplyTone(value: unknown): value is AiReplyTone {
  return typeof value === "string" && (AI_REPLY_TONES as readonly string[]).includes(value);
}

/** Merchant-facing copy for the selector. The hint is what the voice actually sounds like,
 *  not an adjective restating the label. */
export const AI_REPLY_TONE_LABELS: Record<AiReplyTone, { label: string; hint: string }> = {
  friendly: { label: "Friendly", hint: "Warm and specific — thanks them for what they actually said." },
  direct: { label: "Direct", hint: "Short and plain. Leads with the answer, skips the pleasantries." },
  elegant: { label: "Elegant", hint: "Composed and measured, the way a long-established boutique writes." },
};
