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

// shop.brand is Shopify's own Branding settings. `logo` is the primary mark; `squareLogo` is
// the fallback, because a store that set only a square avatar still has a usable mark and a
// square logo renders perfectly well at the small size an email header uses.
const SHOP_BRAND_LOGO_QUERY = `#graphql
  query ShopBrandLogo {
    shop {
      brand {
        logo {
          image {
            url
          }
        }
        squareLogo {
          image {
            url
          }
        }
      }
    }
  }
`;

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

interface ShopBrandLogoResponse {
  data?: {
    shop?: {
      brand?: {
        logo?: { image?: { url?: string | null } | null } | null;
        squareLogo?: { image?: { url?: string | null } | null } | null;
      } | null;
    } | null;
  } | null;
  /** Present when the field does not exist on this API version at all, which is a different
   *  outcome from a merchant simply not having set a logo. */
  errors?: Array<{ message?: string }> | null;
}

/** Reads the shop's brand logo from the Admin API. Returns null on anything unusable. */
export async function fetchShopBrandLogo(admin: AdminApiContext): Promise<string | null> {
  const response = await admin.graphql(SHOP_BRAND_LOGO_QUERY);
  const body = (await response.json()) as ShopBrandLogoResponse;

  // THREE OUTCOMES, ONLY ONE OF WHICH IS "the merchant has no logo"
  //
  // `shop.brand` is documented on Shopify's STOREFRONT API. Whether the Admin API exposes it
  // is, as of 2026-11-08, unverified against a live shop — every attempt so far has been
  // blocked (the Admin token on hand was expired, and the docs search found Brand only under
  // Storefront). If the field does not exist on Admin, this query returns a GraphQL error and
  // every call quietly yields null, which is indistinguishable from a merchant who simply
  // never set a brand logo. The feature would then appear to work and never do anything.
  //
  // So the two cases are separated and logged. The first real install answers the question
  // definitively, in one grep, instead of it staying open for another session.
  if (body.errors?.length) {
    console.warn(
      `[shop-brand-logo] Shopify returned an error for shop.brand — the field may not exist on ` +
        `the Admin API: ${body.errors.map((entry) => entry?.message ?? "unknown").join("; ")}`,
    );
    return null;
  }

  if (!body.data?.shop?.brand) {
    console.warn(
      "[shop-brand-logo] shop.brand resolved to null on the Admin API. Either this shop has no " +
        "brand settings, or the field is unavailable here and the Storefront API is required.",
    );
    return null;
  }

  const primary = body.data?.shop?.brand?.logo?.image?.url ?? null;
  if (isUsableLogoUrl(primary)) {
    return primary.trim();
  }

  const square = body.data?.shop?.brand?.squareLogo?.image?.url ?? null;
  return isUsableLogoUrl(square) ? square.trim() : null;
}

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
