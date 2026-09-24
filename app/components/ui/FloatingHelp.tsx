import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  SUPPORT_EMAIL,
  buildFeedbackMailto,
  buildSupportMailto,
  type SupportContext,
} from "./supportMailto";
import styles from "./floating-help.module.css";

// The app's single support surface, present on every /app/* screen via app.tsx's shell. There
// is no help center, chat system, or ticketing backend — and none is invented here: the CTA
// opens the merchant's own mail client, which is a real, working way to reach a real inbox.
// The address and the exact contents of a support email live in supportMailto.ts, which is
// also where the rule about what must never be included is written down.

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.6a2.7 2.7 0 0 1 5.2.9c0 1.8-2.5 2.3-2.5 3.6" />
      <circle cx="12" cy="17.1" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 3 3 10.5l7 2.5 2.5 7L21 3z" />
      <path d="M12.5 13.5 21 3" />
    </svg>
  );
}

export interface FloatingHelpProps {
  /** Store display name — used in the support email's subject line. Optional so this component
   *  still renders correctly on any surface that hasn't resolved a store yet. */
  storeName?: string | null;
  /** The merchant's myshopify.com domain, for the support email's body. */
  shopDomain?: string | null;
  /** Merchant-facing plan name ("Free"/"Pro"), for the support email's body. */
  planName?: string | null;
}

export function FloatingHelp({ storeName = null, shopDomain = null, planName = null }: FloatingHelpProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const location = useLocation();

  // Path only, never location.search — the embedded app's query string carries App Bridge's
  // own session parameters (host, id_token, hmac), which must never leave the app in an email.
  const context: SupportContext = {
    storeName,
    shopDomain,
    planName,
    path: location.pathname || null,
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    firstItemRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {open ? (
        // role="dialog", not the menu it used to be: the panel now leads with real copy and an
        // address rather than being a list of commands, and a menu role would make a screen
        // reader announce that text as menu items.
        <div className={styles.panel} role="dialog" aria-label="Support">
          <div className={styles.panelHeader}>
            <p className={styles.panelTitle}>Need help?</p>
            <p className={styles.panelText}>Our support team is here to help.</p>
            {/* Shown as plain text as well as being the CTA's destination, so a merchant whose
                machine has no mail client configured can still copy the address. */}
            <p className={styles.panelEmail}>{SUPPORT_EMAIL}</p>
          </div>

          <a
            ref={firstItemRef}
            className={styles.primaryItem}
            href={buildSupportMailto(context)}
            onClick={() => setOpen(false)}
          >
            <span className={styles.itemIcon}>
              <HelpIcon />
            </span>
            Contact Support
          </a>

          <a className={styles.item} href={buildFeedbackMailto({ storeName })} onClick={() => setOpen(false)}>
            <span className={styles.itemIcon}>
              <SendIcon />
            </span>
            Send Feedback
          </a>
        </div>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Help and support"
        onClick={() => setOpen((value) => !value)}
      >
        <HelpIcon />
      </button>
    </div>
  );
}
