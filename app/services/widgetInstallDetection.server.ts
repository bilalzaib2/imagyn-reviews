import prisma from "../db.server";

// General, merchant-agnostic install detection for the theme extension's storefront blocks.
// The app has no `read_themes` Admin scope (see shopify.app.toml), so it cannot query a
// merchant's theme configuration directly. What it CAN do — for any merchant, not just one
// store — is fetch the merchant's own live storefront and look for the exact markers each
// block already renders into the DOM when a merchant has added it (see
// extensions/imagyn-review-widgets/blocks/*.liquid, `data-imagyn-*` attributes below). This
// is the same content any shopper's browser already receives; nothing merchant-specific is
// hardcoded here, and no store-specific selector, ID, or handle appears anywhere in this file.

/**
 * What we actually know about a storefront block, kept deliberately narrow.
 *
 *  - "installed"     confirmed active on the live theme: the block's own marker was found in
 *                    the HTML the storefront served.
 *  - "not-installed" confirmed available but not added: the storefront was read successfully
 *                    and the marker was absent.
 *  - "blocked"       the theme could not be read at all because the storefront is password
 *                    protected. A development-plan store cannot turn that off, so this is a
 *                    permanent condition for some stores, not a transient error.
 *  - "unknown"       unable to verify for any other reason — the fetch failed or timed out, or
 *                    the block can legitimately live on a page we do not check.
 *
 * "blocked" is separate from "unknown" because the two call for different merchant guidance
 * and because collapsing them hides the one case that can never resolve on its own.
 */
export type WidgetInstallState = "installed" | "not-installed" | "blocked" | "unknown";

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
  | "store-reviews"
  | "ai-review-summary"
  | "store-ai-summary";

const FETCH_TIMEOUT_MS = 6000;
const UNREACHABLE_REASON = "Couldn't reach your storefront to verify this automatically.";
const PASSWORD_PROTECTED_REASON =
  "Your storefront currently has password protection turned on, so this can't be checked automatically. Verify in your Theme Editor.";
const NO_PRODUCT_REASON = "This store has no synced products yet, so there's no product page to check.";
const CAROUSEL_NOT_ON_HOME_REASON =
  "Not detected on your homepage. Review Carousel can be added to any page, so this can't be fully confirmed automatically — check your Theme Editor.";
const STORE_REVIEWS_NOT_ON_HOME_REASON =
  "Not detected on your homepage. Store Reviews can be added to any page, so this can't be fully confirmed automatically — check your Theme Editor.";
const STORE_AI_SUMMARY_NOT_ON_HOME_REASON =
  "Not detected on your homepage. Store AI Summary can be added to any page, so this can't be fully confirmed automatically — check your Theme Editor.";

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
    return { state: "blocked", checkedUrl: url, reason: PASSWORD_PROTECTED_REASON };
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
    return { state: "blocked", checkedUrl: homeUrl, reason: PASSWORD_PROTECTED_REASON };
  }
  if (home.html !== null || product?.html !== null) {
    return { state: "not-installed", checkedUrl: homeUrl };
  }
  return { state: "unknown", checkedUrl: homeUrl, reason: UNREACHABLE_REASON };
}

// Unlike the two "canonical location" blocks, a section-target block placeable on any page
// (Review Carousel) has no fixed location — a merchant can put it anywhere.
// A miss on the homepage genuinely cannot be promoted to "not installed" without risking
// exactly the false negative this feature exists to prevent, so it stays "unknown" with an
// explanation instead.
function resolveHomepageOnlyWidget(marker: string, home: FetchResult, homeUrl: string, notOnHomeReason: string): WidgetInstallStatus {
  if (home.passwordProtected) {
    return { state: "blocked", checkedUrl: homeUrl, reason: PASSWORD_PROTECTED_REASON };
  }
  if (home.html === null) {
    return { state: "unknown", checkedUrl: homeUrl, reason: UNREACHABLE_REASON };
  }
  if (home.html.includes(marker)) {
    return { state: "installed", checkedUrl: homeUrl };
  }
  return { state: "unknown", checkedUrl: homeUrl, reason: notOnHomeReason };
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
    "ai-review-summary": productStatus("data-imagyn-ai-summary-block"),
    "collection-rating-badge": resolveEmbedWidget(
      "data-imagyn-collection-badges",
      home,
      homeUrl,
      productFetch,
      productUrl,
    ),
    "review-carousel": resolveHomepageOnlyWidget("data-imagyn-carousel", home, homeUrl, CAROUSEL_NOT_ON_HOME_REASON),
    "store-reviews": resolveHomepageOnlyWidget("data-imagyn-store-reviews", home, homeUrl, STORE_REVIEWS_NOT_ON_HOME_REASON),
    "store-ai-summary": resolveHomepageOnlyWidget(
      "data-imagyn-store-ai-summary",
      home,
      homeUrl,
      STORE_AI_SUMMARY_NOT_ON_HOME_REASON,
    ),
  };

  return result;
}
