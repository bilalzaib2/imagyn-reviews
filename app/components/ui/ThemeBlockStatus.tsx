// Real activation status for this app's storefront blocks, read from App Bridge.
//
// Rendered beside the setup guide's widget step. The server cannot answer this question —
// doing so would need the `read_themes` scope and a re-authorization for every existing
// merchant — but App Bridge can, for free, while the merchant is looking at the page.
//
// Reads window.shopify directly rather than through useAppBridge(), matching
// AppReviewPrompt.tsx: that hook throws synchronously if the App Bridge CDN script has not
// finished executing, which would crash the Dashboard on a slow load instead of simply not
// showing a status chip yet.
import { useEffect, useState } from "react";

import {
  summariseThemeBlocks,
  themeBlockStatusLabel,
  type ThemeBlockStatus as Status,
} from "../../services/themeExtensionStatus.shared";
import { StatusBadge, type StatusBadgeTone } from "./StatusBadge";

function getExtensionsApi(): (() => Promise<unknown>) | null {
  if (typeof window === "undefined") return null;
  const shopify = (window as unknown as { shopify?: { app?: { extensions?: () => Promise<unknown> } } }).shopify;
  return typeof shopify?.app?.extensions === "function" ? shopify.app.extensions.bind(shopify.app) : null;
}

const TONE: Record<Status, StatusBadgeTone> = {
  active: "success",
  available: "warning",
  unavailable: "warning",
  unknown: "neutral",
};

export function ThemeBlockStatus() {
  // Starts as null, not "unknown": before the check has run there is nothing to report, and
  // rendering "Theme status unavailable" for a moment on every load would be noise.
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    const extensions = getExtensionsApi();

    // No App Bridge (an older version, or the script has not loaded): show nothing at all
    // rather than a status we did not determine.
    if (!extensions) return;

    extensions()
      .then((result) => {
        if (!cancelled) setStatus(summariseThemeBlocks(result).status);
      })
      .catch(() => {
        // A platform error is not evidence the widget is missing.
        if (!cancelled) setStatus("unknown");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === null || status === "unknown") return null;

  return <StatusBadge tone={TONE[status]}>{themeBlockStatusLabel(status)}</StatusBadge>;
}
