// Syncs the merchant's own brand logo from Shopify, so a brand-new install's review emails are
// branded with their real logo without the merchant uploading anything.
//
// WHY THIS EXISTS
//
// Before this, the only logo an email could use was one the merchant uploaded in Email Studio
// (Store.emailLogoUrl) or set per-template. A store that had never opened Email Studio sent a
// text-only header — which is exactly what makes a first review request look generic and
// unbranded next to a competitor's. Shopify already holds a brand logo for most stores
// (Settings → Brand), so the branded default is available for free; it just was not being read.
//
// FALLBACK, NEVER AN OVERRIDE
//
// A merchant's explicit choice always wins. Precedence lives in one place,
// emailBranding.shared.ts's resolveEmailLogo:
//
//   1. the template's own custom logo  (logoSource === "custom")
//   2. the store's shared Email Studio logo
//   3. THIS — the Shopify brand logo
//   4. nothing, and the renderer shows the text brand header
//
// So uploading a logo, or explicitly overriding per template, is never second-guessed, and a
// merchant who deliberately removed their logo does not get Shopify's silently reinstated at
// tier 2 — only at tier 3, where nothing else was ever configured.
//
// WHY IT IS CACHED WITH A TTL
//
// Same reason shopContactEmail.server.ts caches: the reminder sweep
// (reviewRequestScheduler.server.ts) runs with no Shopify Admin session at all, so the value
// must be persisted to be usable there. Unlike isDevelopmentStore, which never changes, a
// merchant can replace their logo at any time, so a stored copy goes stale and is re-synced on
// an authenticated page load once older than the TTL.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { setShopBrandLogo } from "./store.server";

/** How long a synced brand logo is trusted before being re-fetched. Matches the contact-email
 *  TTL — both are merchant-editable Shopify settings with the same staleness profile. */
export const SHOP_BRAND_LOGO_TTL_MS = 24 * 60 * 60 * 1000;

// WHY THERE IS NO QUERY HERE ANY MORE — VERIFIED 2026-11-08
//
// This module used to send `{ shop { brand { logo { image { url } } ... } } }` to the ADMIN
// GraphQL API. That field does not exist there.
//
//   Admin API      shopify.dev/docs/api/admin-graphql/latest/objects/Shop  — no `brand` field
//                  (both halves of the field list read; `brand` would sort near the top).
//   Storefront API shopify.dev/docs/api/storefront/latest/objects/Shop     — HAS `brand`,
//                  "The shop's branding configuration", typed Brand (logo, squareLogo,
//                  colors, coverImage).
//
// So every call errored and returned null, for every merchant, since the feature shipped on
// 2026-11-05 — and null is exactly what "this merchant has no logo" looks like, so nothing
// ever surfaced it. It also meant a doomed GraphQL round trip on every single app load, since
// app.tsx calls this fire-and-forget on each request.
//
// WHAT WOULD RE-ENABLE IT
//
// The Storefront API, reached with a storefront access token (Admin's
// `storefrontAccessTokenCreate`) plus unauthenticated read scopes. That is a new scope, which
// forces every existing merchant to re-authorize — an owner decision, not a quiet change. Or
// the Admin `CheckoutBranding` object, which needs `read_checkout_branding_settings` AND a
// Plus or Development store plan, so it cannot serve ordinary merchants.
//
// Until one of those is chosen, tier 3 of the logo chain below is simply unavailable, and the
// honest behaviour is to say so once rather than to keep asking Shopify a question it has no
// field to answer. The merchant-facing experience is unchanged in practice: tiers 1, 2 and 4
// are what has actually been serving every store all along.

/**
 * Validates a URL for use as an email `<img src>`.
 *
 * Shopify is a trusted source, but "trusted" is not "skip validation at a rendering boundary".
 * HTTPS only: an email client loading an http:// image either blocks it or triggers a mixed
 * content warning, and a javascript:/data: value has no business reaching an img src at all.
 * Length-capped so a pathological value cannot bloat every email body.
 */
export function isUsableLogoUrl(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  // Also rejects any whitespace or quote that could break out of the attribute, since a valid
  // absolute https URL cannot contain them unencoded.
  return parsed.protocol === "https:" && !/["'<>\s]/.test(trimmed);
}

/**
 * Always null: Shopify's Admin API has no `shop.brand` field to read (see the note above).
 *
 * Kept as the single named seam for this capability rather than deleted, so that if the
 * Storefront path is ever authorized there is one obvious place to implement it and one
 * obvious place already covered by tests. `admin` stays in the signature for the same reason.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the seam is deliberate, see above
export async function fetchShopBrandLogo(_admin: AdminApiContext): Promise<string | null> {
  return null;
}

/** Whether a Shopify-sourced brand logo can be read at all on the current scopes. */
export const SHOP_BRAND_LOGO_AVAILABLE = false;

/**
 * Ensures the store's cached brand logo is present and fresh, returning the usable value.
 *
 * Mirrors ensureShopContactEmail exactly, including its failure posture: a Shopify API error
 * degrades to the previously stored value and is never allowed to break the page load. An email
 * going out with a text header is a far better outcome than a merchant unable to open the app
 * because Shopify was throttling.
 */
export async function ensureShopBrandLogo(
  admin: AdminApiContext,
  store: { id: string; shopBrandLogoUrl: string | null; shopBrandLogoSyncedAt: Date | null },
  now: Date = new Date(),
): Promise<string | null> {
  // Nothing to sync from while the source is unavailable. Returning the stored value keeps
  // any logo a previous version cached, and skips both the network call and the write — this
  // runs on every app load, so "do nothing" has to actually do nothing.
  if (!SHOP_BRAND_LOGO_AVAILABLE) {
    return isUsableLogoUrl(store.shopBrandLogoUrl) ? store.shopBrandLogoUrl : null;
  }

  const isFresh =
    store.shopBrandLogoSyncedAt !== null &&
    now.getTime() - store.shopBrandLogoSyncedAt.getTime() < SHOP_BRAND_LOGO_TTL_MS;

  if (isFresh) {
    return isUsableLogoUrl(store.shopBrandLogoUrl) ? store.shopBrandLogoUrl : null;
  }

  let fetched: string | null;
  try {
    fetched = await fetchShopBrandLogo(admin);
  } catch {
    // Degrade to whatever is stored rather than clearing a good value on a transient failure.
    // Deliberately not persisted, so the next load retries instead of waiting out the TTL.
    return isUsableLogoUrl(store.shopBrandLogoUrl) ? store.shopBrandLogoUrl : null;
  }

  // Persisted even when null, so a merchant who removed their Shopify logo stops having the
  // stale one used, and so the TTL actually advances rather than re-querying on every load.
  await setShopBrandLogo(store.id, fetched, now);
  return fetched;
}
