import { useEffect, useState } from "react";
import { Card } from "./Card";
import { Button } from "./Button";
import styles from "./app-review-prompt.module.css";

const DISMISS_KEY = "imagyn:appReviewPromptDismissedAt";
// Roughly a business quarter — long enough that "Maybe later" actually means later, short
// enough that a merchant who becomes happier with the app over time gets asked again.
const DISMISS_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

function isDismissed(): boolean {
  if (typeof window === "undefined") return true;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}

// Shopify's documented response shape for reviews.request() — success, plus a code/message
// explaining a decline (rate limits, merchant eligibility, already reviewed, and so on).
interface ReviewRequestResponse {
  success: boolean;
  code?: string;
  message?: string;
}

// Reads window.shopify directly rather than via @shopify/app-bridge-react's useAppBridge() —
// that hook throws synchronously if the App Bridge CDN script (added by app.tsx's AppProvider)
// hasn't finished executing yet, which would crash whatever page renders this on a slow load
// instead of just quietly not offering the button yet.
function getReviewsApi(): { request: () => Promise<ReviewRequestResponse> } | null {
  if (typeof window === "undefined") return null;
  const shopify = (window as unknown as {
    shopify?: { reviews?: { request?: () => Promise<ReviewRequestResponse> } };
  }).shopify;
  return shopify?.reviews?.request ? (shopify.reviews as { request: () => Promise<ReviewRequestResponse> }) : null;
}

// Reusable "leave an app review" nudge — NOT a customer product-review prompt. Callers decide
// *when* it's appropriate to show (a real positive moment: reviews collected, a request cycle
// completed, meaningful time installed — see app._index.tsx for the current trigger) by only
// rendering this with `eligible`; the component itself only owns the dismiss/CTA behavior, so
// that logic lives in exactly one place no matter how many moments end up using this.
//
// "Leave a review" prefers Shopify's own App Bridge reviews.request(), which overlays Shopify's
// native review modal on the app. That call frequently DECLINES — Shopify enforces rate limits
// and eligibility server-side, and its own documentation warns that a merchant-triggered
// request in particular "might prevent the modal from displaying, making your app appear to be
// broken." That is exactly the bug this component had: it called request(), ignored the
// response, and dismissed the banner regardless, so a merchant clicking "Leave a review" often
// saw nothing happen at all and the banner vanish.
//
// So a decline now falls through to the app's real App Store listing page (resolved live from
// Shopify via appStoreListing.server.ts — never a hardcoded apps.shopify.com URL, which would
// be a fabricated link while the app is still unpublished), opened at the top level because an
// apps.shopify.com page cannot render inside the embedded app's iframe. When there is no
// listing URL either — the app genuinely has no public listing yet — the merchant is told so
// honestly and the banner stays put, rather than silently swallowing the click.
export function AppReviewPrompt({
  eligible,
  appStoreUrl = null,
}: {
  eligible: boolean;
  /** The real App Store listing URL, or null when the app has no public listing yet. */
  appStoreUrl?: string | null;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    setDismissed(isDismissed());
  }, []);

  if (!eligible || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  // window.top, not window.open: the App Store listing can't render inside Shopify Admin's
  // embedded iframe, and a plain new-tab open is blocked in some embedded contexts. Assigning
  // the top frame's location is the one navigation that reliably works from inside the iframe
  // for a non-Shopify destination.
  const openAppStoreListing = (url: string) => {
    const top = window.top ?? window;
    top.location.href = url;
  };

  const handleLeaveReview = async () => {
    setUnavailableMessage(null);
    setIsRequesting(true);

    try {
      const reviews = getReviewsApi();

      if (reviews) {
        const result = await reviews.request();

        if (result?.success) {
          // Shopify's own modal is now on screen — it owns the rest of the flow, and asking
          // again later would be noise.
          handleDismiss();
          return;
        }
      }

      // Either App Bridge isn't available yet, or Shopify declined to show the modal. Both
      // mean the same thing for the merchant who just clicked: send them somewhere real.
      if (appStoreUrl) {
        openAppStoreListing(appStoreUrl);
        handleDismiss();
        return;
      }

      setUnavailableMessage(
        "Reviews aren't available right now. Please try again later — or email us at appsupport@imagyn.co.",
      );
    } catch {
      if (appStoreUrl) {
        openAppStoreListing(appStoreUrl);
        handleDismiss();
        return;
      }
      setUnavailableMessage(
        "Reviews aren't available right now. Please try again later — or email us at appsupport@imagyn.co.",
      );
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <Card className={styles.card}>
      <div className={styles.text}>
        <p className={styles.title}>Loving IMAGYN Reviews?</p>
        <p className={styles.body}>Your feedback helps us improve and helps other merchants discover IMAGYN.</p>
        {unavailableMessage ? <p className={styles.notice}>{unavailableMessage}</p> : null}
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="primary" onClick={handleLeaveReview} disabled={isRequesting}>
          {isRequesting ? "Opening…" : "Leave a review"}
        </Button>
        <Button type="button" variant="ghost" onClick={handleDismiss}>
          Maybe later
        </Button>
      </div>
    </Card>
  );
}
