import { useEffect, useState } from "react";
import { useBlocker } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";

interface ContextualSaveBarProps {
  /** Unique per save bar instance — required by the underlying `ui-save-bar` element. */
  id: string;
  /** Real dirty-state, computed by the caller (draft !== persisted values). */
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
  saveLabel?: string;
}

// Wraps App Bridge's real `ui-save-bar` (via @shopify/app-bridge-react's SaveBar), the current
// Shopify-supported Contextual Save Bar — not a custom imitation. `open` is fully controlled by
// the caller's own real dirty-state, so the bar only ever shows when there's an actual unsaved
// change, and Save/Discard call straight into the caller's existing handlers (no parallel save
// logic lives here).
/**
 * True once App Bridge's CDN script has actually executed.
 *
 * useAppBridge() THROWS synchronously when the `shopify` global is missing, and a thrown
 * error in a component body takes the whole route to its error boundary. The script is a
 * CDN tag added by app.tsx's AppProvider, so on a slow network this app can hydrate before
 * it runs — and six screens mount this save bar (Brand Studio, Email Studio and four
 * Settings pages). AppReviewPrompt already reads `window.shopify` defensively for exactly
 * this reason; this is the same guard for a far bigger blast radius.
 */
function useAppBridgeReady(): boolean {
  // Always false for the first render, never seeded from `window.shopify`.
  //
  // Seeding it from the browser made the first CLIENT render disagree with the server, which
  // rendered null because `window` is undefined there. When App Bridge's script had already
  // run, hydration's very first pass emitted <ui-save-bar> against a server payload that had
  // nothing at that position, and App Bridge then relocates that element to <body> anyway —
  // so React reported "Expected server HTML to contain a matching <ui-save-bar> in <div>" and
  // hydration failed outright.
  //
  // A failed hydration is not cosmetic here. React discards the server DOM and re-renders from
  // scratch, and in development that drops React Router's single critical-CSS node, leaving the
  // screen as unstyled HTML until a manual refresh. Measured on verveonline: Email Studio and
  // Brand Studio — two of the six screens mounting this bar — each came back at 0 CSS rules.
  //
  // Deferring to an effect is the fix: the first client render matches the server exactly, and
  // the bar appears a tick later. The effect checks synchronously before polling, so when App
  // Bridge is already present there is no added delay beyond that one tick.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || typeof window === "undefined") return;

    if ((window as { shopify?: unknown }).shopify) {
      setReady(true);
      return;
    }

    // Polled rather than awaited: App Bridge exposes no ready event, and the script
    // typically lands within a frame or two of hydration. Gives up after ~5s, by which point
    // it is not coming and the page is better off without a save bar than without a page.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if ((window as { shopify?: unknown }).shopify) {
        setReady(true);
        window.clearInterval(timer);
      } else if (attempts > 50) {
        window.clearInterval(timer);
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [ready]);

  return ready;
}

export function ContextualSaveBar(props: ContextualSaveBarProps) {
  // Nothing renders until App Bridge exists. The cost is that a merchant briefly has no
  // unsaved-changes bar; the alternative was the entire screen failing to render.
  return useAppBridgeReady() ? <ContextualSaveBarWithAppBridge {...props} /> : null;
}

function ContextualSaveBarWithAppBridge({ id, open, onSave, onDiscard, saving, saveLabel = "Save" }: ContextualSaveBarProps) {
  const shopify = useAppBridge();

  // App Bridge's own leaveConfirmation() guards real browser-level navigation (closing the
  // tab, clicking a Shopify Admin chrome link) automatically once the save bar is showing —
  // but it has no visibility into this app's own React Router client-side route changes.
  // useBlocker is React Router's real navigation-blocking primitive (not a custom modal) for
  // exactly that gap; when it fires, we still surface Shopify's own native Leave/Stay dialog
  // via leaveConfirmation() rather than a bespoke confirm, so the merchant sees one consistent
  // UI regardless of which kind of navigation they attempted.
  const blocker = useBlocker(open);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    // Mirrors Shopify's own documented usage (`await leaveConfirmation(); then navigate`) —
    // the promise is only ever awaited to gate a navigation that should now proceed. If the
    // merchant instead chooses to stay, there is nothing to proceed with; the blocker simply
    // remains in place (React Router leaves the URL untouched) until the next real navigation
    // attempt re-evaluates `open` and, if still dirty, blocks and prompts again.
    shopify.saveBar.leaveConfirmation().then(() => {
      blocker.proceed();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  return (
    <SaveBar id={id} open={open}>
      <button variant="primary" onClick={onSave} {...(saving ? { loading: "" } : {})}>
        {saveLabel}
      </button>
      <button onClick={onDiscard}>Discard</button>
    </SaveBar>
  );
}
