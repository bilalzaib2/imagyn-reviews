// Syncs the merchant's PUBLIC-FACING contact email from Shopify.
//
// WHICH FIELD, AND WHY
//
// Shopify's Admin API exposes two shop-level addresses, and they are not interchangeable:
//
//   shop.contactEmail  "The public-facing contact email address for the shop. CUSTOMERS will
//                       use this email to communicate with the shop owner."
//   shop.email         "The shop owner's email address. SHOPIFY will use this email address to
//                       communicate with the shop owner."
//
// A review request is a customer-facing email, so a customer hitting Reply must reach the
// address Shopify itself designates for customer contact — contactEmail. Using shop.email would
// route customer replies to the merchant's account/login inbox, which is the wrong mailbox and
// may not even be monitored for customer mail.
//
// REPLY-TO ONLY, NEVER FROM
//
// This value is used exclusively as Reply-To. It is never placed in the From header: From
// requires the sending domain to authorise us via DKIM/SPF, and a merchant's own domain does
// not. Reply-To carries no such requirement — it is a routing hint for the recipient's client,
// not an authentication claim. See emailSenderIdentity.shared.ts for that boundary.
//
// WHY IT IS CACHED WITH A TTL RATHER THAN FETCHED PER SEND
//
// The reminder sweep and the reward dispatch both run with no Shopify Admin session at all
// (reviewRequestScheduler.server.ts is deliberately store-agnostic — Prisma and the email
// provider only), so the value has to be persisted to be usable there. Unlike
// isDevelopmentStore, which is fetched once and cached forever because it never changes, a
// merchant can edit their contact email in Shopify settings at any time, so a stored copy goes
// stale. It is therefore re-synced on an authenticated page load once older than the TTL below,
// which keeps it current without a live API call on every request or a webhook subscription.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { setShopContactEmail } from "./store.server";

/** How long a synced contact email is trusted before being re-fetched. */
export const CONTACT_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;

const SHOP_CONTACT_EMAIL_QUERY = `#graphql
  query ShopContactEmail {
    shop {
      contactEmail
    }
  }
`;

/**
 * Validates an address for use as a Reply-To header value.
 *
 * Shopify is a trusted source, but "trusted source" is not "skip validation at a header
 * boundary": exactly one "@" and no delimiter, quote or whitespace, so no value — however it
 * arrived — can terminate the header and append another address.
 */
export function isUsableReplyToAddress(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && /^[^\s<>,;"@]+@[^\s<>,;"@]+\.[^\s<>,;"@]+$/.test(trimmed);
}

interface ShopContactEmailResponse {
  data?: { shop?: { contactEmail?: string | null } | null } | null;
}

/** Reads shop.contactEmail from the Admin API. Returns null on anything unusable. */
export async function fetchShopContactEmail(admin: AdminApiContext): Promise<string | null> {
  const response = await admin.graphql(SHOP_CONTACT_EMAIL_QUERY);
  const body = (await response.json()) as ShopContactEmailResponse;
  const contactEmail = body.data?.shop?.contactEmail ?? null;

  return isUsableReplyToAddress(contactEmail) ? contactEmail.trim() : null;
}

/**
 * Ensures the store's cached contact email is present and fresh, returning the usable value.
 *
 * Mirrors ensureDevelopmentStoreFlag's shape, including its failure posture: a Shopify API
 * error degrades to the previously stored value (or null) and is never allowed to break the
 * page load. A review email going out with the platform Reply-To is a far better outcome than
 * a merchant unable to open the app because Shopify was throttling.
 */
export async function ensureShopContactEmail(
  admin: AdminApiContext,
  store: { id: string; contactEmail: string | null; contactEmailSyncedAt: Date | null },
  now: Date = new Date(),
): Promise<string | null> {
  const isFresh =
    store.contactEmailSyncedAt !== null &&
    now.getTime() - store.contactEmailSyncedAt.getTime() < CONTACT_EMAIL_TTL_MS;

  if (isFresh) {
    return isUsableReplyToAddress(store.contactEmail) ? store.contactEmail : null;
  }

  let fetched: string | null;
  try {
    fetched = await fetchShopContactEmail(admin);
  } catch {
    // Degrade to whatever is already stored rather than clearing a good value on a transient
    // failure. Deliberately not persisted, so the next load retries instead of waiting a day.
    return isUsableReplyToAddress(store.contactEmail) ? store.contactEmail : null;
  }

  // Persisted even when null, so a merchant who cleared their contact email stops having the
  // stale one used, and so the TTL actually advances rather than re-querying on every load.
  await setShopContactEmail(store.id, fetched, now);
  return fetched;
}
