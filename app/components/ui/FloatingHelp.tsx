import { useEffect, useRef, useState } from "react";
import styles from "./floating-help.module.css";

// No help center or feedback form exists yet — mailto keeps this honest and functional
// (opens the merchant's own mail client) instead of linking to a page that doesn't exist.
// One inbox, distinguished by subject line, since a small in-progress app has one, not two.
const SUPPORT_EMAIL = "support@imagyn.co";

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

function supportMailto(subject: string) {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export function FloatingHelp() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

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
        <div className={styles.panel} role="menu" aria-label="Help and feedback">
          <a
            ref={firstItemRef}
            className={styles.item}
            role="menuitem"
            href={supportMailto("Imagyn Reviews support")}
            onClick={() => setOpen(false)}
          >
            <span className={styles.itemIcon}>
              <HelpIcon />
            </span>
            Help &amp; Support
          </a>
          <a className={styles.item} role="menuitem" href={supportMailto("Imagyn Reviews feedback")} onClick={() => setOpen(false)}>
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Help and feedback"
        onClick={() => setOpen((value) => !value)}
      >
        <HelpIcon />
      </button>
    </div>
  );
}
