// Branded Email Sender Identity — the pure half, safe to import from client code.
//
// Split from emailSenderIdentity.server.ts for the same reason email.shared.ts and
// appearance.shared.ts are split from their server counterparts: Email Studio's component
// needs the type and the length cap, and a route module that pulls a *.server file into
// client code fails the build outright. Only platformFromAddress() genuinely needs the
// server, because only it reads process.env.
//
// WHY THE FROM ADDRESS IS MERCHANT-SCOPED BUT NEVER MERCHANT-CONTROLLED
//
// An email's From ADDRESS can only use a domain whose DKIM/SPF authorise the sender. Putting a
// merchant's own address there without that authorisation is spoofing, and in practice it does
// not even work — mailbox providers reject it or route it to spam, and it damages the shared
// domain's reputation for every other merchant. That part has not changed.
//
// What changed is the LOCAL PART. Previously every merchant sent from the single static
// platform address, so an inbox showed "Coastal Threads <reviews@imagyn.co>" — the display name
// was the merchant's, but the address identified Imagyn and nothing else. Judge.me solves this
// by scoping the local part per merchant on its OWN authenticated domain
// (requests+<myshopify_domain>@judge.me), and this mirrors that exactly:
//
//     Coastal Threads <requests+coastal-threads.myshopify.com@imagyn.co>
//
// The domain stays the platform's verified one, so DKIM still signs d=imagyn.co and DMARC still
// aligns. The merchant cannot choose the domain, cannot choose the prefix, and cannot inject an
// address: the identifier is DERIVED from the shop domain the platform already knows, stripped
// to [a-z0-9.-], and length-capped. A merchant supplying "evil@attacker.com" as a store domain
// yields "requests+evilattacker.com@imagyn.co" — still unambiguously the platform's domain.
//
// Replies: a merchant-scoped local part has no mailbox behind it, so Reply-To is no longer
// optional. It resolves to the merchant's verified address, else the per-template address, else
// the platform address itself — which is exactly where replies landed before this change. A
// reply can therefore never fall into a black hole.
//
// True merchant-domain sending (From on the merchant's OWN domain) remains unimplemented on
// purpose; it needs DNS records, provider-side verification and a verified/pending/failed state
// machine. permissions.ts's canUseCustomEmailDomain is reserved for that.
import type { Permissions } from "./permissions";

export interface SenderIdentityStore {
  name: string;
  emailSenderName: string | null;
  /** The shop's myshopify domain — the identifier the merchant-scoped From is derived from.
   *  Globally unique and assigned by Shopify, so it cannot collide between merchants. */
  domain?: string | null;
  /** Fallback identifier when `domain` is absent on an older row. */
  slug?: string | null;
  /** The merchant's public-facing contact email, synced from Shopify's shop.contactEmail.
   *  Shopify designates this as the address customers use to reach the shop owner, so it is
   *  the correct default Reply-To. Never used in the From header. */
  contactEmail?: string | null;
  /** The store-wide Reply-To candidate. Only honoured once verified. */
  replyToEmail?: string | null;
  /** Proof the merchant can read that inbox. Null means the address is NOT used. */
  replyToVerifiedAt?: Date | string | null;
}

export interface SenderIdentity {
  /** What inbox clients show as the sender. */
  displayName: string;
  /** The real From address. Always on the platform's verified DOMAIN; the local part is
   *  scoped to this merchant. */
  fromAddress: string;
  /** True when the local part identifies this merchant rather than being the shared default. */
  fromAddressIsMerchantScoped: boolean;
  /** Whether a usable verified sending address is configured at all. */
  fromAddressConfigured: boolean;
  /** A real merchant inbox for replies, when configured. */
  replyTo: string | null;
  /** Where replyTo came from, so the UI can explain it rather than just showing an address. */
  replyToSource: "verified-store" | "template" | "shopify-contact" | "platform";
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

/** A Reply-To must be a single address: exactly one "@", no delimiter, quote or whitespace, so
 *  no stored value can terminate the header and append a second recipient. */
export function isHeaderSafeAddress(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && /^[^\s<>,;"@]+@[^\s<>,;"@]+\.[^\s<>,;"@]+$/.test(trimmed);
}

/** Fixed, non-merchant-controllable local-part prefix. Mirrors Judge.me's `requests+…`. */
export const MERCHANT_FROM_PREFIX = "requests";

/** Local parts are limited to 64 octets; `requests+` costs 9, so the identifier is capped
 *  well inside that with room to spare. */
const MAX_MERCHANT_IDENTIFIER_LENGTH = 50;

/**
 * Derives the merchant identifier used in the From local part.
 *
 * Deliberately lossy and allow-listed rather than escaped: only [a-z0-9.-] survives, so no
 * supplied value can smuggle in an `@`, a `+`, a quote, a comma or whitespace and change which
 * address or domain the mail claims to come from. Returns null when nothing usable is left, and
 * the caller then falls back to the shared platform address rather than inventing one.
 */
export function merchantFromIdentifier(store: Pick<SenderIdentityStore, "domain" | "slug">): string | null {
  const raw = (store.domain ?? store.slug ?? "").trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9.-]/g, "").replace(/^[.-]+/, "").replace(/[.-]+$/, "");
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_MERCHANT_IDENTIFIER_LENGTH).replace(/[.-]+$/, "") || null;
}

/**
 * Builds the merchant-scoped From address on the platform's verified domain.
 *
 * The DOMAIN is taken from the platform address and never from the store, which is what keeps
 * this authenticated: DKIM signs d=<platform domain> regardless of which merchant is sending.
 */
export function buildMerchantFromAddress(
  platformAddress: string | null,
  store: Pick<SenderIdentityStore, "domain" | "slug">,
): { address: string; merchantScoped: boolean } | null {
  if (!platformAddress) return null;

  const at = platformAddress.lastIndexOf("@");
  if (at < 1 || at === platformAddress.length - 1) return null;
  const domain = platformAddress.slice(at + 1);

  const identifier = merchantFromIdentifier(store);
  if (!identifier) {
    return { address: platformAddress, merchantScoped: false };
  }

  return { address: `${MERCHANT_FROM_PREFIX}+${identifier}@${domain}`, merchantScoped: true };
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

  // The merchant-scoped From. Applies on EVERY plan: identifying the merchant in the address is
  // what the product is, not an upsell. Only the custom brand-name OVERRIDE stays a Pro feature.
  const from = buildMerchantFromAddress(fromAddress, store);

  // Reply-To precedence. A VERIFIED store address wins, because it is the only one anyone has
  // proven they can read. An unverified store address is ignored entirely — saving an address is
  // not verifying it. Verification is NOT plan-gated: a merchant who proved they own an inbox
  // should receive replies regardless of plan, and gating it would silently drop customer
  // replies on downgrade.
  //
  // The platform address is the final fallback rather than null. With a merchant-scoped local
  // part there is no mailbox behind the From, so omitting Reply-To entirely would send replies
  // nowhere; falling back here keeps them landing exactly where they landed before this change.
  const verifiedStoreReplyTo =
    store.replyToVerifiedAt && store.replyToEmail?.trim() ? store.replyToEmail.trim() : null;
  const templateReplyTo = replyTo?.trim() || null;

  // Shopify's shop.contactEmail — the address Shopify itself designates for customers to reach
  // the shop owner. It sits BELOW the two deliberate merchant choices and ABOVE the platform
  // fallback: a merchant who explicitly set an address in Email Studio meant it, but a merchant
  // who set nothing should still receive their own customers' replies rather than having them
  // land in Imagyn's shared inbox. Re-validated here even though the sync already validated it,
  // because this is the value that actually becomes a header.
  const shopifyContactReplyTo = isHeaderSafeAddress(store.contactEmail) ? store.contactEmail!.trim() : null;

  const resolvedReplyTo = verifiedStoreReplyTo ?? templateReplyTo ?? shopifyContactReplyTo ?? fromAddress;

  return {
    displayName: brandedNameActive ? configured! : store.name,
    fromAddress: from?.address ?? "",
    fromAddressIsMerchantScoped: from?.merchantScoped ?? false,
    fromAddressConfigured: from !== null,
    replyTo: resolvedReplyTo,
    replyToSource: verifiedStoreReplyTo
      ? "verified-store"
      : templateReplyTo
        ? "template"
        : shopifyContactReplyTo
          ? "shopify-contact"
          : "platform",
    brandedNameActive,
    brandedNameBlockedReason: brandedNameActive ? null : !entitled ? "not-entitled" : "not-configured",
  };
}
