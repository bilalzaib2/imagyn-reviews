import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

// The app's own Shopify App Store listing URL, read from Shopify rather than hardcoded.
//
// This exists because of a real bug: AppReviewPrompt's "Leave a review" button called App
// Bridge's reviews.request() and nothing else, so whenever Shopify declined to show its native
// modal — which it frequently does, and which its own documentation warns about explicitly for
// a merchant-triggered request ("rate-limiting might prevent the modal from displaying, making
// your app appear to be broken") — the click did nothing visible and the banner dismissed
// itself anyway. The decline codes are real and common: already-reviewed, annual-limit-reached,
// cooldown-period, recently-installed, merchant-ineligible, mobile-app.
//
// The fallback destination has to be the App Store listing, and that URL must not be
// hardcoded: the app's handle can change, and — more importantly — the app is not published
// yet, so any literal apps.shopify.com URL written here today would be a fabricated link to a
// 404 page. App.appStoreAppUrl is Shopify's own answer for this, and it is genuinely null
// until the listing goes live, which is exactly the signal the caller needs.
const APP_STORE_LISTING_QUERY = `#graphql
  query AppStoreListingUrl {
    currentAppInstallation {
      app {
        appStoreAppUrl
      }
    }
  }
`;

// Returns null when the app has no public App Store listing yet, and also whenever the lookup
// itself fails — a dashboard must never fail to load over an optional nicety like this, and the
// caller's own behavior for "no URL" (don't offer a link that goes nowhere) is already the
// correct behavior for "couldn't find out."
export async function getAppStoreListingUrl(admin: AdminApiContext): Promise<string | null> {
  try {
    const response = await admin.graphql(APP_STORE_LISTING_QUERY);
    const body = (await response.json()) as {
      data?: { currentAppInstallation?: { app?: { appStoreAppUrl?: string | null } | null } | null };
    };

    return body.data?.currentAppInstallation?.app?.appStoreAppUrl || null;
  } catch (error) {
    console.error("[appStoreListing] Failed to resolve the App Store listing URL:", error);
    return null;
  }
}
