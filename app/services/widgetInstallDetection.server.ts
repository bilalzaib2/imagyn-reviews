import prisma from "../db.server";

// General, merchant-agnostic install detection for the theme extension's storefront blocks.
// The app has no `read_themes` Admin scope (see shopify.app.toml), so it cannot query a
// merchant's theme configuration directly. What it CAN do — for any merchant, not just one
// store — is fetch the merchant's own live storefront and look for the exact markers each
// block already renders into the DOM when a merchant has added it (see
// extensions/imagyn-review-widgets/blocks/*.liquid, `data-imagyn-*` attributes below). This
// is the same content any shopper's browser already receives; nothing merchant-specific is
// hardcoded here, and no store-specific selector, ID, or handle appears anywhere in this file.

export type WidgetInstallState = "installed" | "not-installed" | "unknown";

export interface WidgetInstallStatus {
  state: WidgetInstallState;
  checkedUrl?: string;
  // Only meaningful (and only shown to merchants) when state === "unknown" — explains why
  // detection couldn't reach a yes/no answer instead of silently guessing.
  reason?: string;
}

export type WidgetInstallKey =
  | "product-reviews-widget"
  | "product-rating-badge"
  | "collection-rating-badge"
  | "review-carousel"
  | "medals-showcase"
  | "store-reviews";

const FETCH_TIMEOUT_MS = 6000;
const UNREACHABLE_REASON = "Couldn't reach your storefront to verify this automatically.";
const PASSWORD_PROTECTED_REASON =
  "Your storefront currently has password protection turned on, so this can't be checked automatically. Verify in your Theme Editor.";
const NO_PRODUCT_REASON = "This store has no synced products yet, so there's no product page to check.";
const CAROUSEL_NOT_ON_HOME_REASON =
  "Not detected on your homepage. Review Carousel can be added to any page, so this can't be fully confirmed automatically — check your Theme Editor.";
const MEDALS_SHOWCASE_NOT_ON_HOME_REASON =
  "Not detected on your homepage. Medals Showcase can be added to any page, so this can't be fully confirmed automatically — check your Theme Editor.";
const STORE_REVIEWS_NOT_ON_HOME_REASON =
  "Not detected on your homepage. Store Reviews can be added to any page, so this can't be fully confirmed automatically — check your Theme Editor.";

interface FetchResult {
  html: string | null;
  passwordProtected: boolean;
}

async function fetchStorefrontHtml(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "User-Agent": "ImagynReviewsWidgetDetector/1.0" },
    });

    // Password-protected storefronts 302 to /password instead of serving the real page —
    // that's a distinct, honest "can't check" case, not "not installed".
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "";
      if (location.includes("/password")) {
        return { html: null, passwordProtected: true };
      }
      return { html: null, passwordProtected: false };
    }

    if (!response.ok) {
      return { html: null, passwordProtected: false };
    }

    return { html: await response.text(), passwordProtected: false };
  } catch {
    return { html: null, passwordProtected: false };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSectionWidget(marker: string, fetched: FetchResult, url: string): WidgetInstallStatus {
  if (fetched.passwordProtected) {
    return { state: "unknown", checkedUrl: url, reason: PASSWORD_PROTECTED_REASON };
  }
  if (fetched.html === null) {
    return { state: "unknown", checkedUrl: url, reason: UNREACHABLE_REASON };
  }
  return fetched.html.includes(marker)
    ? { state: "installed", checkedUrl: url }
    : { state: "not-installed", checkedUrl: url };
}

// App embeds (target: "body") render site-wide once activated in the Theme Editor's App
// Embeds panel — there's no per-template placement — so a hit on either fetched page is
// conclusive, and a miss on both (when both were actually reachable) is conclusive too.
function resolveEmbedWidget(
  marker: string,
  home: FetchResult,
  homeUrl: string,
  product: FetchResult | null,
  productUrl: string | null,
): WidgetInstallStatus {
  if (home.html?.includes(marker)) {
    return { state: "installed", checkedUrl: homeUrl };
  }
  if (product?.html?.includes(marker)) {
    return { state: "installed", checkedUrl: productUrl ?? homeUrl };
  }

  if (home.passwordProtected || product?.passwordProtected) {
    return { state: "unknown", checkedUrl: homeUrl, reason: PASSWORD_PROTECTED_REASON };
  }
  if (home.html !== null || product?.html !== null) {
    return { state: "not-installed", checkedUrl: homeUrl };
  }
  return { state: "unknown", checkedUrl: homeUrl, reason: UNREACHABLE_REASON };
}

// Unlike the two "canonical location" blocks, a section-target block placeable on any page
// (Review Carousel, Medals Showcase) has no fixed location — a merchant can put it anywhere.
// A miss on the homepage genuinely cannot be promoted to "not installed" without risking
// exactly the false negative this feature exists to prevent, so it stays "unknown" with an
// explanation instead.
function resolveHomepageOnlyWidget(marker: string, home: FetchResult, homeUrl: string, notOnHomeReason: string): WidgetInstallStatus {
  if (home.passwordProtected) {
    return { state: "unknown", checkedUrl: homeUrl, reason: PASSWORD_PROTECTED_REASON };
  }
  if (home.html === null) {
    return { state: "unknown", checkedUrl: homeUrl, reason: UNREACHABLE_REASON };
  }
  if (home.html.includes(marker)) {
    return { state: "installed", checkedUrl: homeUrl };
  }
  return { state: "unknown", checkedUrl: homeUrl, reason: notOnHomeReason };
}

// Manual-verification overrides — a general escape hatch for any store where live
// detection is blocked by something outside the app's control (the leading case: a
// development-plan store's storefront password, which Shopify itself won't let the
// merchant turn off — see fetchStorefrontHtml's password-redirect handling above). An
// entry here means a human independently confirmed the real state directly in that
// store's own Shopify Theme Editor — never guessed — and takes precedence over whatever
// the live HTML fetch would otherwise conclude. This is keyed by shop domain so it works
// for any store that needs it, not special-cased detection logic for one merchant; remove
// a store's entry once its storefront is reachable for automatic checks again (e.g. once
// it's on a paid plan and password protection can be turned off).
const MANUAL_VERIFICATION_OVERRIDES: Partial<Record<string, Partial<Record<WidgetInstallKey, WidgetInstallState>>>> = {
  "verveonline.myshopify.com": {
    // Verified 2026-08-16 via Shopify Theme Editor (Online Store > Themes > Dawn (Active)
    // > Edit theme, theme id 150727819563): "Imagyn Reviews" and "Product Rating Badge"
    // blocks both present under the Product information section on the Default product
    // template; "Collection Ratings" app embed toggle is ON in the App Embeds panel;
    // Review Carousel section is absent from the Home page template.
    "product-reviews-widget": "installed",
    "product-rating-badge": "installed",
    "collection-rating-badge": "installed",
    "review-carousel": "not-installed",
  },
};

function applyManualOverride(shop: string, key: WidgetInstallKey, status: WidgetInstallStatus): WidgetInstallStatus {
  const state = MANUAL_VERIFICATION_OVERRIDES[shop]?.[key];
  return state ? { state } : status;
}

export async function detectWidgetInstallStatus(
  shop: string,
  storeId: string,
): Promise<Record<WidgetInstallKey, WidgetInstallStatus>> {
  const baseUrl = `https://${shop}`;
  const homeUrl = `${baseUrl}/`;

  const product = await prisma.product.findFirst({
    where: { storeId, handle: { not: null } },
    select: { handle: true },
  });
  const productUrl = product?.handle ? `${baseUrl}/products/${product.handle}` : null;

  const [home, productFetch] = await Promise.all([
    fetchStorefrontHtml(homeUrl),
    productUrl ? fetchStorefrontHtml(productUrl) : Promise.resolve(null),
  ]);

  const productStatus = (marker: string): WidgetInstallStatus => {
    if (!productUrl || !productFetch) {
      return { state: "unknown", reason: NO_PRODUCT_REASON };
    }
    return resolveSectionWidget(marker, productFetch, productUrl);
  };

  const result: Record<WidgetInstallKey, WidgetInstallStatus> = {
    "product-reviews-widget": productStatus("data-imagyn-reviews"),
    "product-rating-badge": productStatus("data-imagyn-rating-badge"),
    "collection-rating-badge": resolveEmbedWidget(
      "data-imagyn-collection-badges",
      home,
      homeUrl,
      productFetch,
      productUrl,
    ),
    "review-carousel": resolveHomepageOnlyWidget("data-imagyn-carousel", home, homeUrl, CAROUSEL_NOT_ON_HOME_REASON),
    "medals-showcase": resolveHomepageOnlyWidget("data-imagyn-medals-showcase", home, homeUrl, MEDALS_SHOWCASE_NOT_ON_HOME_REASON),
    "store-reviews": resolveHomepageOnlyWidget("data-imagyn-store-reviews", home, homeUrl, STORE_REVIEWS_NOT_ON_HOME_REASON),
  };

  for (const key of Object.keys(result) as WidgetInstallKey[]) {
    result[key] = applyManualOverride(shop, key, result[key]);
  }

  return result;
}
