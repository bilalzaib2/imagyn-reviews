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

// Reads window.shopify directly rather than via @shopify/app-bridge-react's useAppBridge() —
// that hook throws synchronously if the App Bridge CDN script (added by app.tsx's AppProvider)
// hasn't finished executing yet, which would crash whatever page renders this on a slow load
// instead of just quietly not offering the button yet.
function getReviewsApi(): { request: () => Promise<unknown> } | null {
  if (typeof window === "undefined") return null;
  const shopify = (window as unknown as { shopify?: { reviews?: { request?: () => Promise<unknown> } } }).shopify;
  return shopify?.reviews?.request ? (shopify.reviews as { request: () => Promise<unknown> }) : null;
}

// Reusable "leave an app review" nudge — NOT a customer product-review prompt. Callers decide
// *when* it's appropriate to show (a real positive moment: reviews collected, a request cycle
// completed, meaningful time installed — see app._index.tsx for the current trigger) by only
// rendering this with `eligible`; the component itself only owns the dismiss/CTA behavior, so
// that logic lives in exactly one place no matter how many moments end up using this.
//
// "Leave a review" calls Shopify's own official App Bridge reviews.request() — Shopify decides
// whether to actually show its native review modal (it enforces its own rate limits/eligibility
// server-side) and owns the real destination, so there's no App Store URL to get wrong or go
// stale here.
export function AppReviewPrompt({ eligible }: { eligible: boolean }) {
  const [dismissed, setDismissed] = useState(true);

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

  const handleLeaveReview = async () => {
    const reviews = getReviewsApi();
    if (reviews) {
      await reviews.request();
    }
    // Dismissed either way — Shopify may decline to show its modal per its own rate limits, and
    // asking again immediately in the same session isn't useful regardless of the outcome.
    handleDismiss();
  };

  return (
    <Card className={styles.card}>
      <div className={styles.text}>
        <p className={styles.title}>Loving IMAGYN Reviews?</p>
        <p className={styles.body}>Your feedback helps us improve and helps other merchants discover IMAGYN.</p>
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="primary" onClick={handleLeaveReview}>
          Leave a review
        </Button>
        <Button type="button" variant="ghost" onClick={handleDismiss}>
          Maybe later
        </Button>
      </div>
    </Card>
  );
}
