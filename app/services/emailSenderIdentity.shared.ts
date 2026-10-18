// Branded Email Sender Identity — the pure half, safe to import from client code.
//
// Split from emailSenderIdentity.server.ts for the same reason email.shared.ts and
// appearance.shared.ts are split from their server counterparts: Email Studio's component
// needs the type and the length cap, and a route module that pulls a *.server file into
// client code fails the build outright. Only platformFromAddress() genuinely needs the
// server, because only it reads process.env.
//
// WHY THE FROM ADDRESS IS NOT MERCHANT-CONFIGURABLE
//
// The app sends through Resend from a single platform-verified domain. An email's From
// ADDRESS can only be a domain whose SPF/DKIM records authorise the sender; putting a
// merchant's own address there without that authorisation is spoofing, and in practice it
// does not even work — mailbox providers reject it or route it to spam, and it damages the
// shared domain's reputation for every other merchant.
//
// So this feature changes the part that genuinely can change without per-merchant domain
// verification: the DISPLAY NAME. An inbox shows "Pure Nutrition" instead of the raw
// Shopify store name, while the address underneath stays on the verified domain. Replies
// are handled honestly too — Reply-To is a real merchant address when they configure one.
//
// True merchant-domain sending remains unimplemented on purpose; it needs a domain
// verification flow (DNS records, provider-side verification, a verified/pending/failed
// state machine). permissions.ts's canUseCustomEmailDomain is reserved for that, and is
// deliberately NOT what gates this feature.
import type { Permissions } from "./permissions";

export interface SenderIdentityStore {
  name: string;
  emailSenderName: string | null;
  /** The store-wide Reply-To candidate. Only honoured once verified. */
  replyToEmail?: string | null;
  /** Proof the merchant can read that inbox. Null means the address is NOT used. */
  replyToVerifiedAt?: Date | string | null;
}

export interface SenderIdentity {
  /** What inbox clients show as the sender. */
  displayName: string;
  /** The real From address. Always the platform's verified address. */
  fromAddress: string;
  /** Whether a usable verified sending address is configured at all. */
  fromAddressConfigured: boolean;
  /** A real merchant inbox for replies, when configured. */
  replyTo: string | null;
  /** Where replyTo came from, so the UI can explain it rather than just showing an address. */
  replyToSource: "verified-store" | "template" | "none";
  /** True when the merchant's own brand name is what will actually be sent. */
  brandedNameActive: boolean;
  /** Why the brand name is not in effect, when it isn't. */
  brandedNameBlockedReason: "not-entitled" | "not-configured" | null;
}

/** Max length for a display name. Long names are truncated by inbox clients anyway, and a
 *  very long one is a sign of pasted junk rather than a brand. */
export const MAX_SENDER_NAME_LENGTH = 64;

/** A header value must not carry control characters; CR/LF in particular could inject a
 *  second header. Checked by codepoint rather than a regex class so the intent is explicit. */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += char;
  }
  return out;
}

/**
 * Cleans a merchant-supplied sender display name.
 *
 * Returns null for anything that is empty once cleaned, so "   " never becomes a sender
 * name. CR/LF and the quoting characters are removed because this value ends up inside a
 * `Name <address>` header — resend.server.ts sanitises again at the boundary, and both
 * layers are kept: this one so what we persist is already clean, that one so no future
 * caller can bypass it.
 */
export function sanitizeSenderName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = stripControlCharacters(raw.replace(/[\r\n]/g, " "))
    .replace(/["<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SENDER_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The single place that decides what a customer-facing email's sender looks like.
 *
 * Entitlement is applied HERE rather than at the UI or the route, so a Free store cannot
 * obtain a branded sender by any path — a direct POST, a stale saved value from a previous
 * Pro period, or a downgrade mid-schedule. A saved name is preserved on downgrade (nothing
 * deletes the column) and simply stops being applied, so re-upgrading restores it with no
 * merchant action.
 *
 * `fromAddress` is injected rather than read here so this stays pure; the server wrapper in
 * emailSenderIdentity.server.ts supplies the real verified address.
 */
export function resolveSenderIdentityWith(
  store: SenderIdentityStore,
  permissions: Pick<Permissions, "canUseBrandedEmailSender">,
  replyTo: string | null,
  fromAddress: string | null,
): SenderIdentity {
  const configured = sanitizeSenderName(store.emailSenderName);
  const entitled = permissions.canUseBrandedEmailSender === true;
  const brandedNameActive = entitled && configured !== null;

  // Reply-To precedence. A VERIFIED store address wins, because it is the only one anyone
  // has proven they can read. An unverified store address is ignored entirely — saving an
  // address is not verifying it, and it must never silently override a verified one. The
  // per-template address remains the fallback so existing behaviour is unchanged for every
  // store that has not used this feature.
  const verifiedStoreReplyTo =
    entitled && store.replyToVerifiedAt && store.replyToEmail?.trim() ? store.replyToEmail.trim() : null;
  const templateReplyTo = replyTo?.trim() || null;
  const resolvedReplyTo = verifiedStoreReplyTo ?? templateReplyTo;

  return {
    displayName: brandedNameActive ? configured! : store.name,
    fromAddress: fromAddress ?? "",
    fromAddressConfigured: fromAddress !== null,
    replyTo: resolvedReplyTo,
    replyToSource: verifiedStoreReplyTo ? "verified-store" : templateReplyTo ? "template" : "none",
    brandedNameActive,
    brandedNameBlockedReason: brandedNameActive ? null : !entitled ? "not-entitled" : "not-configured",
  };
}
